const assert = require('node:assert/strict');
const test = require('node:test');
const { releaseTarget } = require('./release-target.cjs');

test('a stable tag includes desktop assets', () => {
  assert.deepEqual(releaseTarget('v0.1.2'), {
    version: '0.1.2',
    revision: '',
    desktop: true,
    releaseTag: 'v0.1.2',
    pluginFile: 'ds-bot-0.1.2.tgz',
    checksumsFile: 'SHA256SUMS',
    notesFile: 'docs/releases/v0.1.2.md',
  });
});

test('a revision tag excludes desktop assets while targeting the original release', () => {
  const target = releaseTarget('v0.1.2-r3');
  assert.equal(target.version, '0.1.2');
  assert.equal(target.revision, '3');
  assert.equal(target.desktop, false);
  assert.equal(target.releaseTag, 'v0.1.2');
  assert.equal(target.pluginFile, 'ds-bot-0.1.2-r3.tgz');
  assert.equal(target.checksumsFile, 'SHA256SUMS-r3');
  assert.equal(target.notesFile, 'docs/releases/v0.1.2-r3.md');
});

test('prerelease tags cannot replace a stable desktop update feed', () => {
  assert.throws(() => releaseTarget('v0.1.2-rc.1'), /Use vMAJOR\.MINOR\.PATCH/u);
});
