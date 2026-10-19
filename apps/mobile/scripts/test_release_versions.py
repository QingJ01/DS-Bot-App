import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


@unittest.skipUnless(shutil.which('node'), 'Node is required')
class ReleaseVersionTests(unittest.TestCase):
    def check(self, tag='', change=None, notes=True):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {
                'ds-bot/package.json': {'version': '1.2.3'},
                'apps/mobile/package.json': {'version': '1.2.3'},
                'apps/mobile/app.json': {'expo': {'version': '1.2.3'}},
                'app/package.json': {'name': 'ds-bot-app-desktop', 'version': '1.2.3'},
                'app/package-lock.json': {
                    'version': '1.2.3',
                    'packages': {
                        '': {'version': '1.2.3'},
                        'node_modules/ds-bot': {'version': '1.2.3'},
                    },
                },
            }
            for package in ['ds-bot', 'apps/mobile']:
                files[f'{package}/package-lock.json'] = {'version': '1.2.3', 'packages': {'': {'version': '1.2.3'}}}
            if change:
                name, value = change
                files[name] = value
            for name, value in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(value))
            if notes and tag:
                (root / 'docs/releases').mkdir(parents=True)
                (root / f'docs/releases/{tag}.md').write_text('Release notes')
            return subprocess.run(['node', str(ROOT / 'scripts/check-release.cjs')], cwd=root,
                                  env={**os.environ, 'RELEASE_TAG': tag}, capture_output=True, text=True)

    def test_main_and_pr_checks_require_matching_versions_without_unreleased_notes(self):
        self.assertEqual(self.check().returncode, 0)
        for path, value in [
            ('apps/mobile/package.json', {'version': '1.2.2'}),
            ('ds-bot/package-lock.json', {'version': '1.2.2', 'packages': {'': {'version': '1.2.3'}}}),
            ('apps/mobile/package-lock.json', {'version': '1.2.3', 'packages': {'': {'version': '1.2.2'}}}),
            ('apps/mobile/app.json', {'expo': {'version': '1.2.2'}}),
            ('app/package.json', {'name': 'ds-bot-app-desktop', 'version': '1.2.2'}),
            ('app/package-lock.json', {
                'version': '1.2.3',
                'packages': {
                    '': {'version': '1.2.3'},
                    'node_modules/ds-bot': {'version': '1.2.2'},
                },
            }),
            ('app/package.json', {'name': 'wrong-desktop-name', 'version': '1.2.3'}),
        ]:
            with self.subTest(path=path):
                self.assertNotEqual(self.check(change=(path, value)).returncode, 0)

    def test_tags_require_matching_versions_and_revision_specific_notes(self):
        for tag in ['v1.2.3', 'v1.2.3-r2']:
            with self.subTest(tag=tag):
                self.assertEqual(self.check(tag).returncode, 0)
                self.assertNotEqual(self.check(tag, notes=False).returncode, 0)
        self.assertNotEqual(self.check('v1.2.4').returncode, 0)
        self.assertNotEqual(self.check('v1.2.3-r0').returncode, 0)
