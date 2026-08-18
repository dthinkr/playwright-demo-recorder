const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { buildPlayer } = require('../lib/build');
const { renderVideo } = require('../video');

const ROOT = path.resolve(__dirname, '..');

function makeWorkspace(t, prefix = 'demorec-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeStep(overrides = {}) {
  return {
    html: '<!doctype html><html><body><main>Ready</main></body></html>',
    caption: 'Show the result',
    url: 'https://example.test/demo',
    viewport: { width: 640, height: 480 },
    scroll: { x: 0, y: 0 },
    hotspot: null,
    ...overrides,
  };
}

function makeSnapshotStep() {
  const { html, ...step } = makeStep();
  return {
    ...step,
    snapshot: {
      type: 0,
      id: 0,
      childNodes: [{
        type: 2,
        id: 1,
        tagName: 'html',
        attributes: {},
        childNodes: [{ type: 3, id: 2, textContent: 'Ready' }],
      }],
    },
  };
}

function build(t, step, name = 'demo.html') {
  const dir = makeWorkspace(t);
  const outFile = path.join(dir, name);
  buildPlayer({ steps: [step], title: 'Test demo', outFile });
  return { dir, outFile, html: fs.readFileSync(outFile, 'utf8') };
}

function writeTinyFlow(dir, title) {
  const flowPath = path.join(dir, 'tiny-flow.js');
  fs.writeFileSync(flowPath, `
    module.exports = {
      title: ${JSON.stringify(title)},
      viewport: { width: 640, height: 480 },
      options: { settle: 0, cursorTravel: 0 },
      async run(rec) {
        await rec.goto('data:text/html,<main>Ready</main>', 'Show the result');
      },
    };
  `);
  return flowPath;
}

test('trace-only demos omit the unused rrweb runtime while snapshot demos retain it', (t) => {
  const trace = build(t, makeStep(), 'trace.html');
  const snapshot = build(t, makeSnapshotStep(), 'snapshot.html');

  assert.doesNotMatch(trace.html, /define\("rrwebSnapshot"/,
    'a trace step already contains HTML and must not carry the rrweb rebuild bundle');
  assert.match(snapshot.html, /define\("rrwebSnapshot"/,
    'snapshot steps still need the rrweb rebuild bundle');
  assert.ok(snapshot.html.length - trace.html.length > 50_000,
    'omitting rrweb should materially shrink a trace-only artifact');
});

test('the player does not ship an unused initial callout arrow reference', (t) => {
  const { html } = build(t, makeStep());

  assert.match(html, /<div id="callout" class="hidden"><\/div>/);
  assert.doesNotMatch(html, /arrowEl\s*=/,
    'the arrow is created for each callout; an initial cached reference is dead code');
  assert.doesNotMatch(html, /\bwin\s*=\s*\$\('window'\)/,
    'the cached browser-shell node is never read');
});

test('video rendering refuses to infer an output path that would overwrite its input', async (t) => {
  const { outFile } = build(t, makeStep(), 'demo.txt');
  const original = fs.readFileSync(outFile);

  await assert.rejects(
    renderVideo(outFile, { hold: 0, logger: { log() {} } }),
    /\.html.*--out|--out.*\.html/i,
  );
  assert.deepEqual(fs.readFileSync(outFile), original, 'the input artifact must remain untouched');
});

test('video rendering accepts a file path containing URL metacharacters and leaves one video', (t) => {
  const dir = makeWorkspace(t, 'demorec # local-');
  const htmlPath = path.join(dir, 'demo # one.html');
  const videoPath = path.join(dir, 'demo # one.webm');
  buildPlayer({ steps: [makeStep()], title: 'Test demo', outFile: htmlPath });

  execFileSync(process.execPath, [
    path.join(ROOT, 'video.js'),
    '--out', videoPath,
    '--hold', '0',
    htmlPath,
  ], { cwd: ROOT, stdio: 'pipe', timeout: 30_000 });

  assert.ok(fs.statSync(videoPath).size > 0, 'the requested polished video should exist');
  const duplicateArtifacts = fs.readdirSync(dir).filter((name) => /^page@.*\.webm$/.test(name));
  assert.deepEqual(duplicateArtifacts, [], 'Playwright raw artifacts must be cleaned up');
});

test('recording a flow emits the polished video by default without keeping a raw browsing copy', (t) => {
  const dir = makeWorkspace(t);
  const flowPath = writeTinyFlow(dir, 'Tiny demo');
  const base = path.join(dir, 'published-demo');

  execFileSync(process.execPath, [
    path.join(ROOT, 'record.js'), flowPath,
    '--out', base,
  ], { cwd: ROOT, stdio: 'pipe', timeout: 40_000 });

  assert.ok(fs.statSync(base + '.webm').size > 0,
    'the primary record command should produce the polished video');
  assert.equal(fs.existsSync(base + '-raw.webm'), false,
    'the browsing recording is waste unless explicitly requested');
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => /^page@.*\.webm$/.test(name)),
    [],
    'recording should not expose a second Playwright video artifact',
  );
});

test('--no-video skips all video capture', (t) => {
  const dir = makeWorkspace(t);
  const flowPath = writeTinyFlow(dir, 'Interactive only');
  const base = path.join(dir, 'interactive-only');

  execFileSync(process.execPath, [
    path.join(ROOT, 'record.js'),
    '--out', base,
    '--no-video',
    flowPath,
  ], { cwd: ROOT, stdio: 'pipe', timeout: 20_000 });

  assert.ok(fs.existsSync(base + '.html'), 'the interactive demo should still be produced');
  assert.equal(fs.existsSync(base + '.webm'), false);
  assert.equal(fs.existsSync(base + '-raw.webm'), false);
});

test('--raw-video explicitly keeps one original browsing recording', (t) => {
  const dir = makeWorkspace(t);
  const flowPath = writeTinyFlow(dir, 'Raw requested');
  const base = path.join(dir, 'raw-requested');

  execFileSync(process.execPath, [
    path.join(ROOT, 'record.js'), flowPath,
    '--out', base,
    '--no-video',
    '--raw-video',
  ], { cwd: ROOT, stdio: 'pipe', timeout: 20_000 });

  assert.ok(fs.statSync(base + '-raw.webm').size > 0);
  assert.equal(fs.existsSync(base + '.webm'), false,
    '--no-video should still skip the polished render');
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => /^page@.*\.webm$/.test(name)),
    [],
    'the Playwright artifact copied into the named raw video must not remain beside it',
  );
});

test('a failed flow cannot overwrite the last successful trace', (t) => {
  const dir = makeWorkspace(t);
  const flowPath = path.join(dir, 'failing-flow.js');
  const base = path.join(dir, 'published-demo');
  fs.writeFileSync(flowPath, `
    module.exports = {
      title: 'Partial demo',
      viewport: { width: 640, height: 480 },
      options: { settle: 0, cursorTravel: 0 },
      async run(rec) {
        await rec.goto('data:text/html,<main>Ready</main>', 'Show the result');
        throw new Error('intentional fixture failure');
      },
    };
  `);
  const goodTrace = base + '-trace.zip';
  fs.writeFileSync(goodTrace, 'LAST_GOOD_TRACE');

  const run = spawnSync(process.execPath, [
    path.join(ROOT, 'record.js'), flowPath, '--out', base, '--no-video',
  ], { cwd: ROOT, encoding: 'utf8', timeout: 20_000 });

  assert.notEqual(run.status, 0, 'the fixture flow should report its failure');
  assert.equal(fs.readFileSync(goodTrace, 'utf8'), 'LAST_GOOD_TRACE');
  assert.ok(fs.statSync(base + '-partial-trace.zip').size > 0,
    'debug evidence from the failed run should use the same partial suffix as its HTML');
});

test('a flow that captures no steps cannot overwrite the last successful trace', (t) => {
  const dir = makeWorkspace(t);
  const flowPath = path.join(dir, 'empty-flow.js');
  const base = path.join(dir, 'published-demo');
  fs.writeFileSync(flowPath, `
    module.exports = {
      title: 'Empty demo',
      viewport: { width: 640, height: 480 },
      async run() {},
    };
  `);
  const goodTrace = base + '-trace.zip';
  fs.writeFileSync(goodTrace, 'LAST_GOOD_TRACE');

  const run = spawnSync(process.execPath, [
    path.join(ROOT, 'record.js'), flowPath, '--out', base, '--no-video',
  ], { cwd: ROOT, encoding: 'utf8', timeout: 20_000 });

  assert.notEqual(run.status, 0, 'an empty flow should be rejected');
  assert.equal(fs.readFileSync(goodTrace, 'utf8'), 'LAST_GOOD_TRACE');
  assert.ok(fs.statSync(base + '-partial-trace.zip').size > 0);
});
