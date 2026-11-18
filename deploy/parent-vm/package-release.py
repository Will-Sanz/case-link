#!/usr/bin/env python3
"""Package or verify/extract public Git source only; never operate services or profiles."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile

REPOSITORY = "https://github.com/Will-Sanz/case-link"
ROOT_FILES = {"package.json", "package-lock.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json", "eslint.config.mjs", "tokens.css", ".nvmrc"}
SCRIPTS = {"scripts/" + name for name in (
    "parent-hosted-services.ts", "parent-hosted-profile.ts", "parent-hosted-parser-cleanup.ts",
    "parent-support-worker.ts", "parent-storage-broker.ts", "parent-support-retention.ts",
    "parent-snap-services.ts", "clear-compiler-cache.mjs")}
ASSETS = {"data/verified-forms/snap-pa600fs-2019.pdf", "data/verified-forms/snap-pa600fs-es-2019.pdf",
          "public/pdfjs/6.5.438/jbig2_nowasm_fallback.js", "public/fonts/utility-protected/Geist-Regular.woff2",
          "public/fonts/utility-protected/newsreader-latin-wght-normal.woff2"}
REQUIRED = ROOT_FILES | SCRIPTS | ASSETS | {"src/app/layout.tsx", "src/lib/parent/worker-service.ts", "src/lib/parent/snap-protected-review.ts"}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def file_digest(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def safe_path(path):
    return bool(path and not path.startswith("/") and not re.search(r"[\x00-\x1f\\]", path)
                and all(part not in ("", ".", "..") for part in path.split("/")))


def selected(path):
    if not safe_path(path):
        raise ValueError("Unsafe Git path")
    included = path in ROOT_FILES | SCRIPTS | {"data/resources-seed.sample.csv"} or path.startswith(("src/", "public/", "data/verified-forms/"))
    if not included:
        return False
    if any(part.startswith(".env") for part in path.split("/")) or path.endswith((".pem", ".key", ".p12")):
        raise ValueError("Private configuration is not a release asset")
    return not re.search(r"\.test\.[cm]?[jt]sx?$", path) and PurePosixPath(path).name not in {"test-fixtures.ts", "support-update-test-server.ts", "pgw-application-test-fixtures.ts", "utility-preparation-test-fixtures.ts"}


def git(repo, *args, input=None):
    return subprocess.run(["git", "--no-replace-objects", "-C", str(repo), *args], input=input, capture_output=True, check=True).stdout


def package(repo, commit, output):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("An exact merged commit is required")
    remote = git(repo, "remote", "get-url", "origin").decode().strip()
    if remote not in {REPOSITORY, REPOSITORY + ".git", "git@github.com:Will-Sanz/case-link.git"}:
        raise ValueError("Unexpected repository")
    if git(repo, "rev-parse", "--verify", commit + "^{commit}").decode().strip() != commit:
        raise ValueError("Commit mismatch")
    main = git(repo, "rev-parse", "--verify", "refs/remotes/origin/main^{commit}").decode().strip()
    git(repo, "merge-base", "--is-ancestor", commit, main)
    entries = []
    for row in git(repo, "ls-tree", "-r", "-z", "--full-tree", commit).split(b"\0"):
        if not row:
            continue
        metadata, raw_path = row.split(b"\t", 1)
        path = raw_path.decode("utf-8")
        if selected(path):
            mode, kind, blob = metadata.decode().split()
            if mode not in {"100644", "100755"} or kind != "blob":
                raise ValueError("Release assets must be regular Git files")
            entries.append({"path": path, "mode": mode, "blob": blob})
    entries.sort(key=lambda value: value["path"])
    if not REQUIRED.issubset({value["path"] for value in entries}):
        raise ValueError("Required runtime or verified form/PDF assets are missing")
    batch = io.BytesIO(git(repo, "cat-file", "--batch", input="".join(value["blob"] + "\n" for value in entries).encode()))
    contents = {}
    for value in entries:
        blob, kind, size = batch.readline().decode().split()
        if blob != value["blob"] or kind != "blob":
            raise ValueError("Git object mismatch")
        data = batch.read(int(size))
        if len(data) != int(size) or batch.read(1) != b"\n":
            raise ValueError("Truncated Git object")
        value.update(size=len(data), sha256=digest(data))
        contents[value["path"]] = data
    output.mkdir(mode=0o700)
    archive = output / "source.tar.gz"
    with open(archive, "xb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as zipped, tarfile.open(fileobj=zipped, mode="w") as tar:
        for value in entries:
            item = tarfile.TarInfo("case-link-" + commit + "/" + value["path"])
            item.mode, item.size, item.mtime = (0o755 if value["mode"] == "100755" else 0o644), value["size"], 0
            tar.addfile(item, io.BytesIO(contents[value["path"]]))
    manifest = {"version": "caselink-host-source.v1", "repository": REPOSITORY, "commit": commit,
                "tree": git(repo, "rev-parse", commit + "^{tree}").decode().strip(), "mainTip": main,
                "files": entries, "sourceSha256": digest(canonical(entries)), "requiredAssets": sorted(ASSETS), "archiveSha256": file_digest(archive)}
    target = output / "manifest.json"
    with open(target, "x") as stream:
        json.dump(manifest, stream, indent=2)
        stream.write("\n")
    return {"commit": commit, "files": len(entries), "sourceSha256": manifest["sourceSha256"], "manifestSha256": file_digest(target), "archiveSha256": manifest["archiveSha256"]}


def extract(manifest_path, expected, archive, output, github_archive=False):
    if not re.fullmatch(r"[0-9a-f]{64}", expected) or file_digest(manifest_path) != expected:
        raise ValueError("Reviewed manifest hash mismatch")
    manifest = json.loads(manifest_path.read_bytes())
    if set(manifest) != {"version", "repository", "commit", "tree", "mainTip", "files", "sourceSha256", "requiredAssets", "archiveSha256"} or manifest["version"] != "caselink-host-source.v1" or manifest["repository"] != REPOSITORY:
        raise ValueError("Unexpected source manifest")
    if any(not re.fullmatch(r"[0-9a-f]{40}", manifest[field]) for field in ("commit", "tree", "mainTip")):
        raise ValueError("Invalid source revision")
    entries = manifest["files"]
    records = {}
    for value in entries:
        if set(value) != {"path", "mode", "blob", "size", "sha256"} or not selected(value["path"]) or value["path"] in records or value["mode"] not in {"100644", "100755"}:
            raise ValueError("Invalid or repeated manifest entry")
        if type(value["size"]) is not int or not 0 <= value["size"] <= 100_000_000 or not re.fullmatch(r"[0-9a-f]{64}", value["sha256"]) or not re.fullmatch(r"[0-9a-f]{40}", value["blob"]):
            raise ValueError("Invalid source size or hash")
        records[value["path"]] = value
    if not REQUIRED.issubset(records) or manifest["requiredAssets"] != sorted(ASSETS) or digest(canonical(entries)) != manifest["sourceSha256"]:
        raise ValueError("Incomplete source manifest")
    if not github_archive and file_digest(archive) != manifest["archiveSha256"]:
        raise ValueError("Sanitized archive hash mismatch")
    output.mkdir(mode=0o700)
    prefix, seen = "case-link-" + manifest["commit"], set()
    with tarfile.open(archive, "r:gz") as tar:
        for item in tar:
            name = item.name.rstrip("/")
            if not safe_path(name) or name.split("/", 1)[0] != prefix or not (item.isfile() or item.isdir()):
                raise ValueError("Unsafe archive member")
            if item.isdir():
                continue
            path = name[len(prefix) + 1:]
            if path not in records:
                if github_archive:
                    continue
                raise ValueError("Unexpected archive member")
            value = records[path]
            # GitHub/git archive may add group-write bits; only Git's executable bit survives extraction.
            if path in seen or item.size != value["size"] or item.mode & 0o7000 or item.mode & 0o111 != (0o111 if value["mode"] == "100755" else 0):
                raise ValueError("Repeated or changed archive entry")
            data = tar.extractfile(item).read()
            if digest(data) != value["sha256"]:
                raise ValueError("Source file hash mismatch")
            target = output / path
            target.parent.mkdir(parents=True, exist_ok=True)
            with open(target, "xb") as stream:
                stream.write(data)
            target.chmod(0o755 if value["mode"] == "100755" else 0o644)
            seen.add(path)
    if seen != set(records):
        raise ValueError("Archive is missing reviewed source")
    return {"commit": manifest["commit"], "sourceSha256": manifest["sourceSha256"], "files": len(seen), "transportSha256": file_digest(archive)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("package")
    build.add_argument("--repo", type=Path, required=True)
    build.add_argument("--commit", required=True)
    build.add_argument("--output", type=Path, required=True)
    unpack = sub.add_parser("extract")
    unpack.add_argument("--manifest", type=Path, required=True)
    unpack.add_argument("--manifest-sha256", required=True)
    unpack.add_argument("--archive", type=Path, required=True)
    unpack.add_argument("--output", type=Path, required=True)
    unpack.add_argument("--github-archive", action="store_true", help="Select only reviewed members from the exact public GitHub commit archive")
    args = parser.parse_args()
    try:
        result = package(args.repo, args.commit, args.output) if args.command == "package" else extract(args.manifest, args.manifest_sha256, args.archive, args.output, args.github_archive)
        print(json.dumps(result))
    except Exception:
        parser.exit(1, "Release source verification failed; no service or profile was changed.\n")
