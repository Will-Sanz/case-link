import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("azure_web", Path(__file__).with_name("azure-web-release.py"))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
COMMAND = "command-1"
SHA = "a" * 40
PREVIOUS = "/opt/caselink/releases/" + "b" * 40 + "-www-previous"


def observed(command=COMMAND, started="latest", state="Succeeded", code=0, output=None):
    return {"tags": {"caselinkCommand": command}, "properties": {"instanceView": {
        "startTime": started, "executionState": state, "exitCode": code,
        "output": output if output is not None else f"CASELINK {command} current-build",
    }}}


class DeploymentTest(unittest.TestCase):
    def test_default_public_check_never_calls_azure(self):
        with patch.object(sys, "argv", ["azure-web-release.py", "check"]), \
             patch.object(release, "public_health") as health, patch.object(release, "azure") as azure:
            release.main()
        health.assert_called_once_with()
        azure.assert_not_called()

    def test_requires_current_successful_receipt(self):
        self.assertIsNone(release.receipt(observed(command="other"), COMMAND, "old"))
        self.assertIsNone(release.receipt(observed(started="old"), COMMAND, "old"))
        self.assertIsNone(release.receipt(observed(state="Running"), COMMAND, "old"))
        self.assertIsNone(release.receipt(observed(output="CASELINK previous-build"), COMMAND, "old"))
        self.assertEqual(release.receipt(observed(), COMMAND, "old"), ["current-build"])
        with self.assertRaisesRegex(RuntimeError, "nonzero"):
            release.receipt(observed(code=1), COMMAND, "old")
        with self.assertRaisesRegex(RuntimeError, "TimedOut"):
            release.receipt(observed(state="TimedOut"), COMMAND, "old")

    def test_reconciles_an_ambiguous_submission_without_repeating_it(self):
        with patch.object(release, "uuid4", return_value=type("ID", (), {"hex": COMMAND})()), \
             patch.object(release, "azure", side_effect=[[], observed()]) as azure, \
             patch.object(release, "run", side_effect=subprocess.TimeoutExpired("az", 70)) as command:
            self.assertEqual(release.remote("/virtual-machine", "inspect"), ["current-build"])
        command.assert_called_once()
        self.assertIn("put", command.call_args.args)
        self.assertEqual(azure.call_count, 2)

    def test_does_not_replace_a_running_host_command(self):
        with patch.object(release, "azure", side_effect=[[release.RUN_COMMAND], observed(state="Running")]), \
             patch.object(release, "run") as command:
            with self.assertRaisesRegex(RuntimeError, "still be running"):
                release.remote("/virtual-machine", "inspect")
        command.assert_not_called()

    def test_refuses_schema_changes_before_web_only_cutover(self):
        with patch.object(release, "run", side_effect=[SHA, "", "", "supabase/migrations/new.sql"]):
            with self.assertRaisesRegex(RuntimeError, "schema or service changes"):
                release.validate_release(SHA, PREVIOUS)

    def test_rollback_rejects_a_wrong_build(self):
        with patch.object(release, "remote", side_effect=[["old-build"], ["unexpected"]]) as remote:
            release.rollback("/virtual-machine", SHA, PREVIOUS, "abcdef012345", "old-build")
            with self.assertRaisesRegex(RuntimeError, "original build ID"):
                release.rollback("/virtual-machine", SHA, PREVIOUS, "abcdef012345", "old-build")
        remote.assert_called_with("/virtual-machine", "rollback", sha=SHA, previous=PREVIOUS, release_id="abcdef012345")

    def test_lost_activation_is_inspected_without_restarting_again(self):
        with patch.object(release, "remote", side_effect=[RuntimeError("missing receipt"), ["activated", "new-build"]]) as remote:
            release.activate("/virtual-machine", "new-build", {})
        self.assertEqual([call.args[1] for call in remote.call_args_list], ["activate", "reconcile"])
        with patch.object(release, "remote", side_effect=[RuntimeError("missing receipt"), ["previous", "old-build"]]):
            with self.assertRaisesRegex(RuntimeError, "previous release is healthy"):
                release.activate("/virtual-machine", "new-build", {})

    def test_deploy_returns_exact_context_for_browser_verification(self):
        def write_package(*args):
            output = Path(args[-1])
            output.mkdir()
            (output / "manifest.json").write_text("{}")
        with patch.object(release, "validate_release", return_value="b" * 40), \
             patch.object(release, "run", side_effect=write_package), \
             patch.object(release, "remote", side_effect=[["new-build"], ["new-build"]]) as remote:
            context = release.deploy("/virtual-machine", SHA, PREVIOUS, "old-build")
        self.assertEqual([call.args[1] for call in remote.call_args_list], ["stage", "activate"])
        self.assertEqual(context, {"sha": SHA, "previous": PREVIOUS, "release_id": remote.call_args.kwargs["release_id"], "build": "new-build", "old_build": "old-build"})


if __name__ == "__main__":
    unittest.main()
