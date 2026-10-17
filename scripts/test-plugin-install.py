"""Exercise real pnpm installs using DSH's hoisted profile settings, in disposable profiles."""

import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent
RELEASE = json.loads((ROOT / "plugin-installer/release.json").read_text(encoding="utf-8"))
ARCHIVE = Path(os.environ["DSBOT_PLUGIN_ARCHIVE"]).resolve()
PNPM = shutil.which(os.environ.get("DSBOT_PNPM", "pnpm"))


class InstallationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if PNPM is None:
            raise RuntimeError("pnpm must be available")
        cls.payload = ARCHIVE.read_bytes()
        if hashlib.sha256(cls.payload).hexdigest() != RELEASE["sha256"]:
            raise RuntimeError("Test archive does not match the published release")
        cls.integrity = "sha512-" + base64.b64encode(hashlib.sha512(cls.payload).digest()).decode()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix=".dsh-test-plugin-install-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.local = self.root / "包 with spaces" / ARCHIVE.name
        self.local.parent.mkdir()
        self.local.write_bytes(self.payload)

    def profile(self, name):
        path = self.root / name
        path.mkdir()
        (path / "package.json").write_text(json.dumps({
            "name": "dsh-test-" + name, "private": True,
            "dependencies": {"is-number": "7.0.0"},
            "dsh": {"profile": {"bundles": ["ds-bot"]}},
        }), encoding="utf-8")
        (path / "pnpm-workspace.yaml").write_text(
            "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n", encoding="utf-8"
        )
        (path / "chat-sentinel.txt").write_text("Keep this data unchanged.", encoding="utf-8")
        return path

    def pnpm(self, profile, *args, allow_failure=False):
        result = subprocess.run([
            PNPM, "--dir", str(profile), *args,
            "--config.ignore-scripts=true", "--store-dir", str(self.root / "store"),
            "--reporter", "append-only",
        ], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
        if not allow_failure:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def assert_installed(self, profile):
        manifest = json.loads((profile / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["dependencies"]["is-number"], "7.0.0")
        self.assertEqual(manifest["dsh"], {"profile": {"bundles": ["ds-bot"]}})
        self.assertEqual((profile / "chat-sentinel.txt").read_text(encoding="utf-8"), "Keep this data unchanged.")
        package = json.loads((profile / "node_modules/ds-bot/package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], RELEASE["version"])
        self.assertIn(self.integrity, (profile / "pnpm-lock.yaml").read_text(encoding="utf-8"))
        self.assertTrue((profile / "node_modules/is-number/package.json").is_file())
        self.assertTrue((profile / "node_modules/qrcode/package.json").is_file())

    def frozen_reinstall(self, profile):
        before = (profile / "pnpm-lock.yaml").read_bytes()
        shutil.rmtree(profile / "node_modules")
        self.pnpm(profile, "install", "--frozen-lockfile")
        self.assertEqual((profile / "pnpm-lock.yaml").read_bytes(), before)
        self.assert_installed(profile)

    def test_bundle_is_reproducible_and_preserves_the_release_archive(self):
        spec = importlib.util.spec_from_file_location("installer_build", ROOT / "build-plugin-installer.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        first = module.build(ARCHIVE, self.root / "first")
        second = module.build(ARCHIVE, self.root / "second")
        self.assertEqual(first.read_bytes(), second.read_bytes())
        with zipfile.ZipFile(first) as bundle:
            self.assertEqual(bundle.read(RELEASE["archive"]), self.payload)
            self.assertTrue(bundle.read("prepare-plugin.ps1").startswith(b"\xef\xbb\xbf"))
            for line in bundle.read("SHA256SUMS.txt").decode().splitlines():
                checksum, name = line.split("  ", 1)
                self.assertEqual(hashlib.sha256(bundle.read(name)).hexdigest(), checksum)

    def test_local_install_remove_reinstall_and_frozen_install(self):
        profile = self.profile("local")
        spec = "ds-bot@file:" + self.local.as_posix()
        self.pnpm(profile, "add", spec)
        self.assert_installed(profile)
        self.pnpm(profile, "remove", "ds-bot")
        self.pnpm(profile, "add", spec)
        self.assert_installed(profile)
        self.frozen_reinstall(profile)

    def test_remote_cache_failure_recovers_with_local_named_spec(self):
        profile = self.profile("remote")
        self.pnpm(profile, "add", RELEASE["url"])
        self.assert_installed(profile)
        self.pnpm(profile, "remove", "ds-bot")
        cached = self.pnpm(profile, "add", "ds-bot@" + RELEASE["url"], allow_failure=True)
        if cached.returncode:
            self.assertIn("ERR_PNPM_MISSING_TARBALL_INTEGRITY", cached.stdout + cached.stderr)
            print("Confirmed remote cache integrity failure; testing supported local recovery.", flush=True)
        self.pnpm(profile, "add", "ds-bot@file:" + self.local.as_posix())
        self.assert_installed(profile)
        self.frozen_reinstall(profile)

    @unittest.skipUnless(os.name == "nt", "Windows PowerShell helper")
    def test_windows_helper_prepares_verified_package_and_rejects_corruption(self):
        spec = importlib.util.spec_from_file_location("installer_build", ROOT / "build-plugin-installer.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        bundle = module.build(ARCHIVE, self.root / "bundle")
        unpacked = self.root / "解压 with spaces"
        with zipfile.ZipFile(bundle) as archive:
            archive.extractall(unpacked)
        destination = self.root / "长期 packages"

        def prepare():
            return subprocess.run([
                "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                str(unpacked / "prepare-plugin.ps1"), "-DestinationDirectory", str(destination),
                "-NoClipboard",
            ], capture_output=True, timeout=60)

        for _ in range(2):
            result = prepare()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        staged = destination / RELEASE["archive"]
        self.assertEqual(staged.read_bytes(), self.payload)
        text = (destination / "INSTALL.txt").read_text(encoding="utf-8-sig")
        line = next(line for line in text.splitlines() if line.startswith("ds-bot@file:"))
        profile = self.profile("helper")
        self.pnpm(profile, "add", line)
        self.assert_installed(profile)
        self.pnpm(profile, "remove", "ds-bot")
        self.pnpm(profile, "add", line)
        self.frozen_reinstall(profile)

        staged.write_bytes(b"corrupted destination")
        self.assertNotEqual(prepare().returncode, 0)
        self.assertEqual(staged.read_bytes(), b"corrupted destination")
        staged.unlink()
        (unpacked / RELEASE["archive"]).write_bytes(b"corrupted download")
        self.assertNotEqual(prepare().returncode, 0)
        self.assertFalse(staged.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
