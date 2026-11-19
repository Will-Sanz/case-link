import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("package-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.email", "synthetic@example.invalid")
        self.git("config", "user.name", "Synthetic release test")
        self.git("remote", "add", "origin", release.REPOSITORY + ".git")
        for path in release.REQUIRED | {"src/ordinary.ts", "src/leak.test.ts", "src/lib/parent/test-fixtures.ts", "src/lib/parent/pgw-application-test-fixtures.ts", "src/lib/parent/utility-preparation-test-fixtures.ts", "src/features/parent/support-update-test-server.ts", "tests/fixtures/household.json", "output/private.json", ".env.production"}:
            target = self.repo / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("Synthetic source: " + path)
        (self.repo / "scripts/clear-compiler-cache.mjs").chmod(0o755)
        self.commit = self.save()
        self.git("update-ref", "refs/remotes/origin/main", self.commit)

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.repo), *args], capture_output=True, check=True).stdout

    def save(self):
        self.git("add", ".")
        self.git("commit", "-qm", "Synthetic source")
        return self.git("rev-parse", "HEAD").decode().strip()

    def package(self, name="bundle"):
        output = self.root / name
        summary = release.package(self.repo, self.commit, output)
        return output, summary

    def unpack(self, bundle, summary, archive=None, github=False, name="extracted"):
        target = self.root / name
        result = release.extract(bundle / "manifest.json", summary["manifestSha256"], archive or bundle / "source.tar.gz", target, github)
        return target, result

    def test_exact_git_bytes_deterministic_and_no_private_or_test_transfer(self):
        (self.repo / "src/ordinary.ts").write_text("Uncommitted content")
        (self.repo / "src/untracked.ts").write_text("Untracked content")
        bundle, summary = self.package()
        second, second_summary = self.package("again")
        self.assertEqual(summary, second_summary)
        self.assertEqual((bundle / "source.tar.gz").read_bytes(), (second / "source.tar.gz").read_bytes())
        target, result = self.unpack(bundle, summary)
        self.assertEqual((target / "src/ordinary.ts").read_text(), "Synthetic source: src/ordinary.ts")
        self.assertEqual((target / "scripts/clear-compiler-cache.mjs").stat().st_mode & 0o777, 0o755)
        for path in ["src/untracked.ts", "src/leak.test.ts", "src/lib/parent/test-fixtures.ts", "src/lib/parent/pgw-application-test-fixtures.ts", "src/lib/parent/utility-preparation-test-fixtures.ts", "src/features/parent/support-update-test-server.ts", "tests", "output", ".env.production", ".git"]:
            self.assertFalse((target / path).exists(), path)
        self.assertEqual(result["files"], len(release.REQUIRED) + 1)
        self.assertTrue(release.selected("src/lib/parent/water-local-test-preparation.ts"))

    def test_public_commit_archive_selectively_extracts_with_git_mode_normalization(self):
        bundle, summary = self.package()
        archive = self.root / "github.tar.gz"
        archive.write_bytes(self.git("archive", "--format=tar.gz", "--prefix=case-link-" + self.commit + "/", self.commit))
        target, result = self.unpack(bundle, summary, archive, True)
        self.assertFalse((target / "output").exists())
        self.assertEqual((target / "src/ordinary.ts").stat().st_mode & 0o777, 0o644)
        self.assertEqual(result["sourceSha256"], summary["sourceSha256"])

    def test_requires_exact_merged_commit_and_expected_repository(self):
        for value in ["HEAD", "main", "-" * 40]:
            with self.assertRaises(ValueError):
                release.package(self.repo, value, self.root / "invalid")
        (self.repo / "src/new.ts").write_text("Not on origin/main")
        later = self.save()
        with self.assertRaises(subprocess.CalledProcessError):
            release.package(self.repo, later, self.root / "unmerged")
        self.git("remote", "set-url", "origin", "https://example.invalid/repo")
        with self.assertRaises(ValueError):
            self.package()

    def test_git_replacements_cannot_relabel_different_source_as_the_merged_commit(self):
        (self.repo / "src/ordinary.ts").write_text("Synthetic replacement source")
        replacement = self.save()
        self.git("replace", self.commit, replacement)
        bundle, summary = self.package()
        target, result = self.unpack(bundle, summary)
        self.assertEqual(result["commit"], self.commit)
        self.assertEqual((target / "src/ordinary.ts").read_text(), "Synthetic source: src/ordinary.ts")

    def test_required_assets_and_selected_symlinks_or_dotenv_fail_closed(self):
        for kind in ["asset", "symlink", "dotenv"]:
            with self.subTest(kind=kind):
                if kind == "asset":
                    (self.repo / sorted(release.ASSETS)[0]).unlink()
                elif kind == "symlink":
                    (self.repo / "src/unsafe.ts").symlink_to("../outside")
                else:
                    (self.repo / "public/.env.local").write_text("Synthetic private setting")
                commit = self.save()
                self.git("update-ref", "refs/remotes/origin/main", commit)
                with self.assertRaises(ValueError):
                    release.package(self.repo, commit, self.root / kind)
                self.git("reset", "--hard", self.commit)

    def test_manifest_or_archive_mismatch_and_existing_output_fail_before_overwrite(self):
        bundle, summary = self.package()
        with self.assertRaises(ValueError):
            release.extract(bundle / "manifest.json", "a" * 64, bundle / "source.tar.gz", self.root / "bad")
        (bundle / "source.tar.gz").write_bytes(b"Changed archive")
        with self.assertRaises(ValueError):
            self.unpack(bundle, summary)
        output = self.root / "existing"
        output.mkdir()
        (output / "keep").write_text("Original")
        with self.assertRaises(FileExistsError):
            release.package(self.repo, self.commit, output)
        self.assertEqual((output / "keep").read_text(), "Original")

    def test_github_archive_rejects_traversal_links_duplicate_changed_and_missing_members(self):
        bundle, summary = self.package()
        originals = []
        with tarfile.open(bundle / "source.tar.gz") as tar:
            for item in tar:
                originals.append((item, tar.extractfile(item).read()))
        for kind in ["traversal", "symlink", "hardlink", "duplicate", "changed", "missing", "setuid", "executable"]:
            with self.subTest(kind=kind):
                archive = self.root / (kind + ".tar.gz")
                with tarfile.open(archive, "w:gz") as tar:
                    for index, (original, data) in enumerate(originals):
                        item = tarfile.TarInfo(original.name)
                        item.size, item.mode = original.size, original.mode
                        if index == 0:
                            if kind == "missing":
                                continue
                            if kind == "traversal":
                                item.name = "../outside"
                            if kind in ["symlink", "hardlink"]:
                                item.type = tarfile.SYMTYPE if kind == "symlink" else tarfile.LNKTYPE
                                item.linkname, item.size = "../outside", 0
                            if kind == "changed":
                                data = b"x" * len(data)
                            if kind == "setuid":
                                item.mode |= 0o4000
                            if kind == "executable":
                                item.mode |= 0o111
                        tar.addfile(item, io.BytesIO(data))
                        if index == 0 and kind == "duplicate":
                            tar.addfile(item, io.BytesIO(data))
                with self.assertRaises(ValueError):
                    self.unpack(bundle, summary, archive, True, kind)
                self.assertFalse((self.root / "outside").exists())


if __name__ == "__main__":
    unittest.main()
