#!/usr/bin/env python3
"""Run the reviewed web-only rollout through one Azure VM Run Command resource."""
import argparse
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import urlopen
from uuid import uuid4

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
ORIGIN = "https://www.thecaselink.com"
RESOURCE_GROUP = "caselink-dev-rg"
VM = "caselink-dev-01"
LOCATION = "northcentralus"
RUN_COMMAND = "caselink-github-web"
BUILD_ID = re.compile(r"[A-Za-z0-9_-]{1,80}")
RELEASE_PATH = re.compile(r"/opt/caselink/releases/([a-f0-9]{40})-[A-Za-z0-9_-]+")


def run(*args):
    return subprocess.run(args, cwd=ROOT, check=True, text=True, stdout=subprocess.PIPE, timeout=70).stdout.strip()


def azure(*args):
    result = run("az", *args, "--only-show-errors", "--output", "json")
    return json.loads(result) if result else {}


def public_health():
    with urlopen(ORIGIN + "/api/health", timeout=10) as response:
        if json.load(response).get("status") != "ok":
            raise RuntimeError("CaseLink public health did not report ready.")


def render_script(values):
    script = (HERE / "azure-web-host.sh").read_text()
    header, body = script.split("\n", 1)
    assignments = "\n".join(f"{key}={shlex.quote(str(value))}" for key, value in values.items())
    return f"{header}\n{assignments}\n{body}"


def receipt(instance, command_id, previous_start):
    props = instance.get("properties", {})
    view = props.get("instanceView") or {}
    if (instance.get("tags") or {}).get("caselinkCommand") != command_id or not view.get("startTime") or view["startTime"] == previous_start:
        return None
    state = view.get("executionState")
    if state in {"Failed", "TimedOut", "Canceled", "Cancelled"}:
        raise RuntimeError(f"Azure host operation ended in {state}. Check the private VM release log before retrying.")
    if state != "Succeeded":
        return None
    if view.get("exitCode") != 0:
        raise RuntimeError("Azure host operation reported a nonzero exit. Check the private VM release log.")
    prefix = f"CASELINK {command_id} "
    for line in (view.get("output") or "").splitlines():
        if line.startswith(prefix):
            return line[len(prefix):].split()
    return None


def remote(vm_id, operation, **values):
    command_id = uuid4().hex
    uri = f"https://management.azure.com{vm_id}/runCommands/{RUN_COMMAND}?api-version=2024-11-01"
    expanded = uri + "&%24expand=instanceView"
    # A new command must have a fresh execution timestamp and its own receipt.
    previous = azure("vm", "run-command", "list", "--resource-group", RESOURCE_GROUP, "--vm-name", VM,
                     "--query", f"[?name=='{RUN_COMMAND}'].name")
    previous_start = None
    if previous:
        view = azure("rest", "--method", "get", "--url", expanded)["properties"].get("instanceView") or {}
        if view.get("executionState") not in {"Succeeded", "Failed", "TimedOut", "Canceled", "Cancelled"}:
            raise RuntimeError("Another Azure command may still be running. Inspect it before retrying.")
        previous_start = view.get("startTime")
    timeout = {"stage": 1500, "inspect": 250, "activate": 550, "reconcile": 550, "rollback": 300}[operation]
    request = {
        "location": LOCATION,
        "tags": {"caselinkCommand": command_id},
        "properties": {
            "source": {"script": render_script({"operation": operation, "command_id": command_id, **values})},
            "timeoutInSeconds": timeout,
            "asyncExecution": True,
            "treatFailureAsDeploymentFailure": True,
        },
    }
    with tempfile.TemporaryDirectory() as temp:
        body = Path(temp) / "command.json"
        body.write_text(json.dumps(request))
        try:
            run("az", "rest", "--method", "put", "--url", uri, "--body", f"@{body}", "--only-show-errors", "--output", "none")
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            print(f"Azure did not confirm submission of {operation}. Checking state rather than submitting again.", flush=True)
    deadline = time.monotonic() + timeout + 90
    while time.monotonic() < deadline:
        try:
            view = azure("rest", "--method", "get", "--url", expanded)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            time.sleep(8)
            continue
        result = receipt(view, command_id, previous_start)
        if result:
            return result
        time.sleep(8)
    raise RuntimeError(f"Azure did not return a confirmed {operation} receipt. Inspect the VM and live site before retrying.")


def validate_release(sha, previous):
    if not re.fullmatch(r"[a-f0-9]{40}", sha) or run("git", "rev-parse", "HEAD") != sha:
        raise RuntimeError("Expected the exact checked-out release SHA.")
    run("git", "merge-base", "--is-ancestor", sha, "origin/main")
    live = RELEASE_PATH.fullmatch(previous)
    if not live:
        raise RuntimeError("Unexpected current web release directory.")
    run("git", "merge-base", "--is-ancestor", live[1], sha)
    changed = run("git", "diff", "--name-only", live[1], sha, "--", "supabase/migrations", "deploy/parent-vm/*.service",
                  "deploy/parent-vm/*.timer", "deploy/parent-vm/*.slice", "deploy/parent-vm/Caddyfile",
                  "deploy/parent-vm/caselink-parent@worker.service.d", "scripts/parent-hosted-*.ts",
                  "scripts/parent-support-worker.ts", "scripts/parent-storage-broker.ts", "scripts/parent-support-retention.ts",
                  "scripts/parent-snap-services.ts", "src/lib/parent/worker-service.ts",
                  "src/lib/parent/protected-frontdoor.ts", "src/lib/parent/snap-protected-review.ts")
    if changed:
        raise RuntimeError("This release has schema or service changes. Use the coordinated release process.")
    return live[1]


def verify_live(build):
    if not BUILD_ID.fullmatch(build):
        raise RuntimeError("Expected a verified build ID.")
    public_health()
    with urlopen(f"{ORIGIN}/get-support?release={build}", timeout=15) as response:
        if build not in response.read().decode():
            raise RuntimeError("Live Get support did not return the expected build.")
    subprocess.run(["node", "tests/parent/live-web-smoke.mjs"], cwd=ROOT, check=True, timeout=120)


def activate(vm_id, build, arguments):
    try:
        if remote(vm_id, "activate", **arguments) == [build]:
            return
    except (RuntimeError, subprocess.SubprocessError):
        print("Activation did not return a confirmed receipt. Checking the active build.", flush=True)
    result = remote(vm_id, "reconcile", **arguments)
    if result == ["activated", build]:
        print("The VM confirmed that the expected build passed cutover.", flush=True)
        return
    if result[0] == "previous":
        raise RuntimeError("Activation did not complete. The previous release is healthy.")
    raise RuntimeError("The active release could not be verified. Inspect the VM before retrying.")


def deploy(vm_id, sha, previous, old_build):
    live = validate_release(sha, previous)
    if live == sha:
        print("This build is already live.")
        return {"build": old_build}
    release_id = uuid4().hex[:12]
    arguments = {"sha": sha, "previous": previous, "release_id": release_id}
    print(f"Staging {sha} as release {release_id}.", flush=True)
    with tempfile.TemporaryDirectory() as temp:
        package = Path(temp) / "package"
        run("python3", str(HERE / "package-release.py"), "package", "--repo", str(ROOT), "--commit", sha, "--output", str(package))
        manifest = (package / "manifest.json").read_bytes()
        [build] = remote(vm_id, "stage", **arguments,
                         manifest_b64=base64.b64encode(gzip.compress(manifest, mtime=0)).decode(),
                         manifest_sha=hashlib.sha256(manifest).hexdigest(),
                         packer_sha=hashlib.sha256((HERE / "package-release.py").read_bytes()).hexdigest())
    if not BUILD_ID.fullmatch(build):
        raise RuntimeError("Invalid staged build ID.")
    print(f"Staged build {build}. Switching the web service.", flush=True)
    activate(vm_id, build, arguments)
    return {**arguments, "build": build, "old_build": old_build}


def rollback(vm_id, sha, previous, release_id, old_build):
    if not re.fullmatch(r"[a-f0-9]{40}", sha) or not re.fullmatch(r"[a-f0-9]{12}", release_id) or not RELEASE_PATH.fullmatch(previous) or not BUILD_ID.fullmatch(old_build):
        raise RuntimeError("Invalid release information for rollback.")
    [restored] = remote(vm_id, "rollback", sha=sha, previous=previous, release_id=release_id)
    if restored != old_build:
        raise RuntimeError("Rollback did not return the original build ID.")
    print(f"Restored previous healthy build {old_build}.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("check", "connect", "deploy", "verify", "rollback"))
    for name in ("sha", "previous", "release-id", "old-build", "build"):
        parser.add_argument(f"--{name}", default="")
    args = parser.parse_args()
    if args.operation == "verify":
        verify_live(args.build)
        print(f"CaseLink is live at {ORIGIN} (build {args.build}).")
        return
    if args.operation == "check":
        public_health()
        print("The CaseLink public website is healthy.")
        return
    output = Path(os.environ["GITHUB_OUTPUT"]) if args.operation == "deploy" else None
    vm = azure("vm", "show", "--resource-group", RESOURCE_GROUP, "--name", VM, "--query", "{id:id,name:name,location:location}")
    expected_id = f"/subscriptions/{os.environ['AZURE_SUBSCRIPTION_ID']}/resourceGroups/{RESOURCE_GROUP}/providers/Microsoft.Compute/virtualMachines/{VM}"
    if vm["id"].lower() != expected_id.lower() or vm["name"] != VM or vm["location"] != LOCATION:
        raise RuntimeError("Azure returned an unexpected deployment target.")
    if args.operation == "rollback":
        rollback(expected_id, args.sha, args.previous, args.release_id, args.old_build)
        return
    previous, old_build = remote(expected_id, "inspect")
    if not RELEASE_PATH.fullmatch(previous) or not BUILD_ID.fullmatch(old_build):
        raise RuntimeError("Invalid current-release receipt.")
    print(f"Authenticated Azure preflight confirmed current healthy build {old_build}.", flush=True)
    if output is not None:
        with output.open("a") as stream:
            for key, value in deploy(expected_id, args.sha, previous, old_build).items():
                stream.write(f"{key}={value}\n")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, HTTPError, subprocess.SubprocessError, ValueError, KeyError) as error:
        raise SystemExit(str(error)) from error
