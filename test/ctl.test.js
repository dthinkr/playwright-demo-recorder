const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

test('attach session files belong to the caller project, not the installed package', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'demorec-attach-'));
  const packageState = path.join(ROOT, '.session.json');
  assert.equal(fs.existsSync(packageState), false,
    'the source checkout must not already have a live attach session during this test');
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const run = spawnSync(process.execPath, [
    path.join(ROOT, 'ctl.js'), 'start', '--out', path.join(workspace, 'demo'),
  ], { cwd: workspace, encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr);
  assert.ok(fs.existsSync(path.join(workspace, '.session.json')),
    'an npm-installed CLI must keep mutable state in the caller workspace');
  assert.equal(fs.existsSync(packageState), false,
    'the package directory must remain immutable');
});

test('auto-generated attach captions never copy the current form value', () => {
  const source = fs.readFileSync(path.join(ROOT, 'ctl.js'), 'utf8');
  assert.doesNotMatch(source, /\bel\.value\b/,
    'an input value can contain a password, token, or other typed secret');
  assert.equal((source.match(/maskInputFn:\s*\(\)\s*=>\s*'••••••'/g) || []).length, 2,
    'manual and auto snapshots should use the same fixed password placeholder');
});
