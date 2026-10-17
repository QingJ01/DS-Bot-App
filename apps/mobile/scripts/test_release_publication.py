import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


@unittest.skipUnless(shutil.which("node") and shutil.which("bash"), "Node and Bash are required")
class ReleasePublicationTests(unittest.TestCase):
    def run_publication(self, tag, published=False, bad_checksum=False, partial=False):
        with tempfile.TemporaryDirectory(prefix="dsbot-release-test-") as directory:
            task = Path(directory)
            (task / "scripts").mkdir()
            shutil.copyfile(ROOT / "scripts/release-target.cjs", task / "scripts/release-target.cjs")
            (task / "bin").mkdir()
            (task / "legacy-input").mkdir()
            original = b"original immutable plugin"
            (task / "legacy-input/ds-bot-0.1.1.tgz").write_bytes(original)
            checksum = "0" * 64 if bad_checksum else hashlib.sha256(original).hexdigest()
            (task / "legacy-input/SHA256SUMS").write_text(checksum + "  ds-bot-0.1.1.tgz\n", encoding="utf-8")
            (task / "legacy-input/DeepSeekBot.cer").write_bytes(b"unchanged certificate")
            for arch in ["arm64", "x86_64"]:
                destination = task / ("out/dsbot-android-" + arch)
                destination.mkdir(parents=True)
                (destination / ("dsbot-android-" + arch + ".apk")).write_bytes(b"test APK")
                (destination / "DeepSeekBot.cer").write_bytes(b"unchanged certificate")
            (task / "out/dsbot-plugin").mkdir()
            (task / "out/dsbot-plugin/ds-bot-0.1.1.tgz").write_bytes(b"revised plugin")
            script = task / "bin/gh"
            script.write_text('''#!/usr/bin/env python3
import json,os,shutil,sys
from pathlib import Path
args=sys.argv[1:]
root=Path(os.environ['GITHUB_WORKSPACE'])
log=root/'commands.json'
calls=json.loads(log.read_text()) if log.exists() else []
calls.append(args);log.write_text(json.dumps(calls))
if args[:2]==['release','download']:
    for item in (root/'legacy-input').iterdir():shutil.copyfile(item,root/'legacy'/item.name)
elif args[:2]==['release','view']:
    print('ds-bot-0.1.1-r2.tgz' if os.environ.get('REVISION_PUBLISHED')=='partial' else 'SHA256SUMS-r2' if os.environ.get('REVISION_PUBLISHED')=='1' else 'SHA256SUMS')
elif args[:2] not in [['release','upload'],['release','edit'],['release','create']]:sys.exit(2)
''', encoding="utf-8")
            script.chmod(0o755)
            workflow = (ROOT / ".github/workflows/build.yml").read_text(encoding="utf-8")
            block = workflow.split("      - name: Publish matching plugin and signed APKs\n", 1)[1].split("        run: |\n", 1)[1]
            program = "\n".join(line[10:] for line in block.splitlines())
            environment = dict(os.environ, PATH=str(task / "bin") + os.pathsep + os.environ["PATH"],
                               RELEASE_TAG=tag, REPOSITORY="owner/repo", GITHUB_WORKSPACE=str(task),
                               REVISION_PUBLISHED="partial" if partial else "1" if published else "0")
            result = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", program], cwd=task,
                                    env=environment, capture_output=True, text=True)
            calls = json.loads((task / "commands.json").read_text(encoding="utf-8")) if (task / "commands.json").exists() else []
            return result.returncode, calls, result.stderr

    def test_revision_uploads_only_new_assets(self):
        code, calls, error = self.run_publication("v0.1.1-r2")
        self.assertEqual(code, 0, error)
        upload = next(call for call in calls if call[:2] == ["release", "upload"])
        self.assertIn("ds-bot-0.1.1-r2.tgz", upload)
        self.assertIn("./dsbot-android-arm64-v0.1.1-r2.apk", upload)
        self.assertIn("SHA256SUMS-r2", upload)
        self.assertNotIn("--clobber", upload)
        for original in ["ds-bot-0.1.1.tgz", "SHA256SUMS", "DeepSeekBot.cer"]:
            self.assertNotIn(original, upload)
        self.assertTrue(any(call[:3] == ["release", "edit", "v0.1.1"] for call in calls))
        edit = next(call for call in calls if call[:2] == ["release", "edit"])
        self.assertNotIn("--latest", edit, "Revising an older release must not promote it over newer versions")

    def test_original_release_still_creates_a_verified_tag_release(self):
        code, calls, error = self.run_publication("v0.1.1")
        self.assertEqual(code, 0, error)
        create = next(call for call in calls if call[:2] == ["release", "create"])
        self.assertIn("ds-bot-0.1.1.tgz", create)
        self.assertIn("--verify-tag", create)
        self.assertFalse(any(call[:2] == ["release", "upload"] for call in calls))

    def test_published_revision_cannot_be_overwritten(self):
        code, calls, _ = self.run_publication("v0.1.1-r2", published=True)
        self.assertNotEqual(code, 0)
        self.assertFalse(any(call[1] in ["upload", "edit"] for call in calls))

    def test_original_integrity_failure_stops_publication(self):
        code, calls, _ = self.run_publication("v0.1.1-r2", bad_checksum=True)
        self.assertNotEqual(code, 0)
        self.assertFalse(any(call[1] in ["upload", "edit"] for call in calls))

    def test_partial_revision_cannot_overwrite_a_downloaded_archive(self):
        code, calls, _ = self.run_publication("v0.1.1-r2", partial=True)
        self.assertNotEqual(code, 0)
        self.assertFalse(any(call[1] in ["upload", "edit"] for call in calls))
