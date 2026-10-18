import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("plugin_installer", ROOT / "scripts/build-plugin-installer.py")
INSTALLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALLER)


class PluginInstallerTests(unittest.TestCase):
    def test_normal_install_text_is_consistent_across_user_guides(self):
        metadata = json.loads((ROOT / "releases/plugin-install.json").read_text())
        spec = metadata["spec"]
        current_release_notes = f"docs/releases/{metadata['revision']}.md"
        for name in ["README.md", "README.zh.md", "docs/getting-started.md",
                     "docs/getting-started.zh.md", "docs/plugin-install-recovery.md",
                     current_release_notes]:
            with self.subTest(document=name):
                self.assertIn(spec, (ROOT / name).read_text(encoding="utf-8"))

    def test_untrusted_archive_is_rejected_before_creating_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            archive = path / "package.tgz"
            archive.write_bytes(b"unexpected release bytes")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                INSTALLER.build(archive, path / "out")
            self.assertFalse((path / "out").exists())
