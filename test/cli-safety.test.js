const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demorec-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeSteps(file) {
  fs.writeFileSync(file, JSON.stringify({
    title: 'Original',
    steps: [{
      html: '<!doctype html><html><body>Ready</body></html>',
      caption: 'Ready',
      url: 'https://example.test/',
      viewport: { width: 640, height: 480 },
      scroll: { x: 0, y: 0 },
      hotspot: null,
    }],
  }));
}

test('rebuild never overwrites a JSON source whose name lacks -steps', (t) => {
  const dir = workspace(t);
  const src = path.join(dir, 'capture.json');
  writeSteps(src);
  const original = fs.readFileSync(src, 'utf8');

  const run = spawnSync(process.execPath, [path.join(ROOT, 'rebuild.js'), src], {
    cwd: dir,
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.readFileSync(src, 'utf8'), original, 'source JSON must remain intact');
  assert.ok(fs.existsSync(path.join(dir, 'capture.html')));
});

test('rebuild accepts named options before the positional input', (t) => {
  const dir = workspace(t);
  const src = path.join(dir, 'capture-steps.json');
  writeSteps(src);

  const run = spawnSync(process.execPath, [
    path.join(ROOT, 'rebuild.js'), '--title', 'Published title', src,
  ], { cwd: dir, encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr);
  const html = fs.readFileSync(path.join(dir, 'capture.html'), 'utf8');
  assert.match(html, /Published title/);
});

test('rebuild rejects an explicit output path that is the source JSON', (t) => {
  const dir = workspace(t);
  const src = path.join(dir, 'capture-steps.json');
  writeSteps(src);
  const original = fs.readFileSync(src, 'utf8');

  const run = spawnSync(process.execPath, [
    path.join(ROOT, 'rebuild.js'), src, '--out', src,
  ], { cwd: dir, encoding: 'utf8' });

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /output.*source|source.*output/i);
  assert.equal(fs.readFileSync(src, 'utf8'), original);
});

test('trace conversion accepts named options before the positional input', (t) => {
  const dir = workspace(t);
  const traceJson = path.join(dir, 'trace.trace');
  const networkJson = path.join(dir, 'trace.network');
  const traceZip = path.join(dir, 'trace.zip');
  const out = path.join(dir, 'published');
  const events = [
    {
      type: 'frame-snapshot',
      snapshot: {
        callId: 'call@1',
        snapshotName: 'before@call@1',
        html: ['HTML', {}, ['BODY', {}, ['BUTTON', {}, 'Continue']]],
        frameUrl: 'https://example.test/',
        viewport: { width: 640, height: 480 },
        isMainFrame: true,
      },
    },
    { type: 'before', callId: 'call@1', method: 'click', params: { selector: 'button' } },
  ];
  fs.writeFileSync(traceJson, events.map((event) => JSON.stringify(event)).join('\n'));
  fs.writeFileSync(networkJson, '');
  execFileSync('zip', ['-q', '-j', traceZip, traceJson, networkJson]);

  const run = spawnSync(process.execPath, [
    path.join(ROOT, 'from-trace.js'), '--title', 'Published trace', traceZip, '--out', out,
  ], { cwd: dir, encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr);
  assert.match(fs.readFileSync(out + '.html', 'utf8'), /Published trace/);
});
