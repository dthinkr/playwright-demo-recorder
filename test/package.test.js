const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PKG = require('../package.json');

test('the npm package has a real public API, CLI, and supported Node range', () => {
  assert.equal(PKG.name, 'playwright-demo-recorder');
  assert.equal(PKG.version, '0.1.0');
  assert.match(PKG.description || '', /agent/i);
  assert.match(PKG.engines?.node || '', />=20/);
  assert.match(PKG.dependencies?.playwright || '', />=1\.40/,
    'the range should allow compatible existing Playwright 1.x installs to be reused');
  assert.match(PKG.dependencies?.playwright || '', /<2/);

  const main = path.join(ROOT, PKG.main || '');
  assert.ok(PKG.main && fs.existsSync(main), 'package.json main must exist');

  assert.equal(PKG.bin?.['playwright-demo'], './cli.js');
  assert.equal(PKG.bin?.['playwright-demo-recorder'], './cli.js');
  assert.ok(fs.existsSync(path.join(ROOT, 'cli.js')), 'the declared CLI must exist');
});

test('the public API exports the three reusable pipeline pieces', () => {
  const api = require('..');
  assert.equal(typeof api.DemoRecorder, 'function');
  assert.equal(typeof api.buildPlayer, 'function');
  assert.equal(typeof api.stepsFromTrace, 'function');
});

test('CLI help presents the sample, three capture routes, and post-processing commands', () => {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'cli.js'), '--help'], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  for (const command of ['sample', 'record', 'attach', 'trace', 'rebuild', 'video']) {
    assert.match(run.stdout, new RegExp(`\\b${command}\\b`));
  }
});

test('each command has help that succeeds before checking optional prerequisites', () => {
  for (const command of ['sample', 'record', 'attach', 'trace', 'rebuild', 'video']) {
    const run = spawnSync(process.execPath, [path.join(ROOT, 'cli.js'), command, '--help'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: '' },
    });
    assert.equal(run.status, 0, `${command}: ${run.stderr}`);
    assert.match(run.stdout, new RegExp(`playwright-demo ${command}`));
  }
});

test('attach fails with an actionable prerequisite error when playwright-cli is absent', (t) => {
  const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'demorec-path-'));
  t.after(() => fs.rmSync(emptyPath, { recursive: true, force: true }));
  const run = spawnSync(process.execPath, [path.join(ROOT, 'cli.js'), 'attach', 'status'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: emptyPath },
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /playwright-cli.*required/i);
});

test('the publish allowlist excludes recordings, sessions, and tests', () => {
  const run = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  // npm 11 prints an array; npm 12 keys the report by package name.
  const packed = Array.isArray(report) ? report[0] : report[PKG.name];
  const files = packed.files.map((file) => file.path);
  assert.ok(files.includes('cli.js'));
  assert.ok(files.includes('index.js'));
  assert.ok(files.includes('sample.js'));
  assert.ok(files.includes('THIRD_PARTY_NOTICES.md'));
  for (const publicFile of [
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'docs/assets/hero.png',
    'docs/assets/routes.svg',
  ]) {
    assert.ok(files.includes(publicFile), `${publicFile} should survive in the npm README`);
  }
  assert.equal(files.some((file) => /^(out|test|\.playwright-cli)\//.test(file)), false);
  assert.equal(files.some((file) => /(?:-trace\.zip|-steps\.json|\.webm)$/.test(file)), false);
});

test('a packed install works with dependencies hoisted into a clean consumer', (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'demorec-consumer-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const packedRun = spawnSync('npm', ['pack', '--json', '--pack-destination', sandbox], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(packedRun.status, 0, packedRun.stderr);
  const report = JSON.parse(packedRun.stdout);
  const packed = Array.isArray(report) ? report[0] : report[PKG.name];
  const tarball = path.join(sandbox, packed.filename);

  const consumer = path.join(sandbox, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({
    name: 'demo-recorder-consumer',
    version: '1.0.0',
    private: true,
  }));
  // npm 12 exports the user's `allow-scripts` setting into lifecycle tests,
  // then rejects that inherited value as a project-scoped install option.
  const installEnv = { ...process.env };
  for (const key of Object.keys(installEnv)) {
    if (key.toLowerCase() === 'npm_config_allow_scripts') delete installEnv[key];
  }
  const install = spawnSync('npm', [
    // A fresh CI runner may not have every transitive dependency in its npm
    // cache. Prefer the cache without making cache warmth a test prerequisite.
    'install', tarball, '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline',
  ], { cwd: consumer, encoding: 'utf8', env: installEnv });
  assert.equal(install.status, 0, install.stderr || install.stdout);

  const installed = path.join(consumer, 'node_modules', PKG.name);
  for (const dependency of [
    path.join('rrweb-snapshot'),
    path.join('@floating-ui', 'core'),
    path.join('@floating-ui', 'dom'),
  ]) {
    assert.equal(fs.existsSync(path.join(installed, 'node_modules', dependency)), false,
      `${dependency} should be hoisted so the test catches package-local path assumptions`);
  }

  const fixture = path.join(sandbox, 'trace-fixture');
  fs.mkdirSync(fixture);
  const events = [
    {
      type: 'frame-snapshot',
      snapshot: {
        callId: 'call@1',
        snapshotName: 'before@call@1',
        frameUrl: 'https://example.test/page?token=secret#private',
        viewport: { width: 800, height: 600 },
        isMainFrame: true,
        html: ['HTML', {}, ['BODY', {}, ['P', {}, 'Clean consumer trace fixture']]],
      },
    },
    {
      type: 'before',
      callId: 'call@1',
      class: 'Frame',
      method: 'click',
      params: { selector: 'p:has-text("Clean consumer trace fixture")' },
    },
  ];
  fs.writeFileSync(path.join(fixture, 'trace.trace'),
    events.map((event) => JSON.stringify(event)).join('\n'));
  fs.writeFileSync(path.join(fixture, 'trace.network'), '');
  const traceZip = path.join(sandbox, 'trace.zip');
  const zip = spawnSync('zip', [
    '-q', '-j', traceZip,
    path.join(fixture, 'trace.trace'),
    path.join(fixture, 'trace.network'),
  ], { encoding: 'utf8' });
  assert.equal(zip.status, 0, zip.stderr);

  const smoke = `
    const fs = require('node:fs');
    const path = require('node:path');
    const api = require(${JSON.stringify(PKG.name)});
    const rrwebOut = path.join(process.cwd(), 'rrweb.html');
    api.buildPlayer({
      title: 'Installed API',
      outFile: rrwebOut,
      steps: [{
        snapshot: { type: 0, id: 0, childNodes: [{
          type: 2, id: 1, tagName: 'html', attributes: {}, childNodes: [],
        }] },
        caption: 'Installed build',
        url: 'https://example.test/',
        viewport: { width: 800, height: 600 },
        scroll: { x: 0, y: 0 },
        hotspot: null,
      }],
    });
    const traced = api.stepsFromTrace(${JSON.stringify(traceZip)});
    const traceOut = path.join(process.cwd(), 'trace.html');
    api.buildPlayer({ title: traced.title, steps: traced.steps, outFile: traceOut });
    if (!fs.statSync(rrwebOut).size || !fs.statSync(traceOut).size) process.exit(1);
  `;
  const apiRun = spawnSync(process.execPath, ['-e', smoke], {
    cwd: consumer,
    encoding: 'utf8',
  });
  assert.equal(apiRun.status, 0, apiRun.stderr || apiRun.stdout);

  for (const binary of ['playwright-demo', 'playwright-demo-recorder']) {
    const cliRun = spawnSync(path.join(consumer, 'node_modules', '.bin', binary), ['--version'], {
      cwd: consumer,
      encoding: 'utf8',
    });
    assert.equal(cliRun.status, 0, cliRun.stderr);
    assert.equal(cliRun.stdout.trim(), PKG.version);
  }

  const sampleOut = path.join(consumer, 'sample.html');
  const sampleRun = spawnSync(
    path.join(consumer, 'node_modules', '.bin', 'playwright-demo'),
    ['sample', '--out', sampleOut],
    { cwd: consumer, encoding: 'utf8' },
  );
  assert.equal(sampleRun.status, 0, sampleRun.stderr || sampleRun.stdout);
  assert.ok(fs.statSync(sampleOut).size > 1000,
    'the installed CLI should generate a real sample without a browser or trace fixture');
});
