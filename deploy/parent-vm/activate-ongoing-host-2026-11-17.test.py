import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('host_activation', Path(__file__).with_name('activate-ongoing-host-2026-11-17.py'))
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)


class ExistingHostActivation(unittest.TestCase):
    def profile(self, role):
        expiry = '2000-01-01T00:00:00Z' if role == 'sender' else '2027-11-08T05:00:00Z' if role in ('web', 'frontdoor') else '2026-11-17T21:07:45Z' if role == 'worker' else '2026-11-11T05:00:00Z'
        return {'service': role, 'publicOrigin': 'https://pilot.thecaselink.com' if role == 'sender' else 'https://www.thecaselink.com', 'projectOrigin': 'https://zpfypkizsapvsxeykmdq.supabase.co', 'enabled': role != 'sender', 'approvedUntil': expiry, 'approvalReference': 'old', 'sendingApproved': False, 'credential': 'synthetic-private-value', 'recipient': 'existing'}

    def test_only_operating_metadata_changes_for_all_eight_existing_roles(self):
        for role in operator.ROLES:
            original = self.profile(role)
            after = operator.ongoing_profile(original, role)
            self.assertIsNone(after['approvedUntil'])
            self.assertEqual({k: v for k, v in after.items() if k not in ('approvedUntil', 'approvalReference')}, {k: v for k, v in original.items() if k not in ('approvedUntil', 'approvalReference')})
            self.assertIsNotNone(original['approvedUntil'])

    def test_changed_scope_or_deadline_rejects(self):
        for delta in ({'publicOrigin': 'https://other.example'}, {'projectOrigin': 'https://other.supabase.co'}, {'enabled': False}, {'approvedUntil': None}, {'service': 'sender'}):
            with self.assertRaises(AssertionError):
                operator.ongoing_profile({**self.profile('worker'), **delta}, 'worker')
        with self.assertRaises(AssertionError):
            operator.ongoing_profile({**self.profile('sender'), 'sendingApproved': True}, 'sender')

    def test_atomic_private_replacement_preserves_owner_and_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'profile.json'
            path.write_text(json.dumps(self.profile('worker')))
            path.chmod(0o600)
            metadata = path.stat()
            replacement = json.dumps(operator.ongoing_profile(self.profile('worker'), 'worker')).encode()
            operator.replace_private(path, replacement, metadata)
            self.assertEqual(path.read_bytes(), replacement)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.stat().st_uid, os.getuid())
            self.assertEqual(list(Path(directory).iterdir()), [path])
            link = Path(directory) / 'link.json'
            link.symlink_to(path)
            with self.assertRaises(AssertionError):
                operator.replace_private(link, b'changed', metadata)
            self.assertEqual(path.read_bytes(), replacement)


if __name__ == '__main__':
    unittest.main()
