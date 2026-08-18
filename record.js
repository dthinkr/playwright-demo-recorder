#!/usr/bin/env node
/**
 * CLI entry: run a flow file, emit an interactive demo + a video + a trace.
 *
 *   node record.js examples/basic-flow.cjs [--headed] [--out out/example]
 *
 * A flow file exports { title, viewport?, run(recorder, page) }. Keeping the
 * flow as a committed file (rather than a one-off agent session) is the point:
 * re-running it after a UI change regenerates the demo, which is the thing
 * hosted demo tools cannot do — they need a human to re-click the extension.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const { DemoRecorder } = require('./lib/recorder');
const { buildPlayer } = require('./lib/build');
const { renderVideo } = require('./video');

const USAGE = 'usage: node record.js <flow.js> [--headed] [--out DIR/NAME] '
  + '[--no-video] [--raw-video]';

function parseArgs(args) {
  const parsed = {
    flowPath: null,
    headed: false,
    makePolishedVideo: true,
    keepRawVideo: false,
    out: null,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--headed') parsed.headed = true;
    else if (arg === '--no-video') parsed.makePolishedVideo = false;
    else if (arg === '--raw-video') parsed.keepRawVideo = true;
    else if (arg === '--out') {
      if (args[i + 1] == null) throw new Error('--out requires a value');
      parsed.out = args[++i];
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else if (parsed.flowPath) {
      throw new Error(`unexpected second flow path: ${arg}`);
    } else {
      parsed.flowPath = arg;
    }
  }
  return parsed;
}

async function main() {
  const {
    flowPath, headed, makePolishedVideo, keepRawVideo, out,
  } = parseArgs(process.argv.slice(2));
  if (!flowPath) {
    console.error(USAGE);
    process.exit(1);
  }
  const base = out
    ? out
    : path.join('out', path.basename(flowPath, '.js'));

  const flow = require(path.resolve(flowPath));
  const viewport = flow.viewport ?? { width: 1440, height: 900 };
  const browser = await chromium.launch({ headless: !headed });
  const rawArtifactDir = keepRawVideo
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'demo-recorder-raw-'))
    : null;
  let context = null;
  let rec = null;
  let failure = null;
  let rawVideoPath = null;
  let suffix = '';
  let tracePath = null;
  try {
    const contextOptions = { viewport };
    if (rawArtifactDir) contextOptions.recordVideo = { dir: rawArtifactDir, size: viewport };
    context = await browser.newContext(contextOptions);
    await context.tracing.start({ screenshots: true, snapshots: true });

    const page = await context.newPage();
    // Dev servers compile routes on first hit; 30s defaults are too tight to
    // record against a cold stack.
    page.setDefaultTimeout(flow.timeout ?? 120000);
    rec = new DemoRecorder(page, flow.options);
    await rec.init();

    try {
      await flow.run(rec, page);
    } catch (error) {
      // Keep whatever was captured before the failure — a partial demo still
      // shows how far the flow got, which is useful when debugging.
      failure = error;
    }

    suffix = failure || rec.steps.length === 0 ? '-partial' : '';
    tracePath = path.resolve(base + suffix + '-trace.zip');
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    await context.tracing.stop({ path: tracePath });

    const rawVideo = page.video();
    await context.close();
    context = null;
    if (rawVideo) {
      rawVideoPath = path.resolve(base + suffix + '-raw.webm');
      await rawVideo.saveAs(rawVideoPath).catch(() => { rawVideoPath = null; });
    }
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    if (rawArtifactDir) fs.rmSync(rawArtifactDir, { recursive: true, force: true });
  }

  if (rec.steps.length === 0) {
    console.error('no steps captured');
    if (failure) console.error(failure);
    process.exit(1);
  }

  // A run that died mid-flow must not clobber a good capture sitting at the
  // same path: partial output goes to a `.partial` name, so the previous
  // recording survives a transient failure (wrong branch, slow backend, a
  // selector that moved).
  if (failure) {
    console.log(`\nflow ended early — writing to ${path.basename(base)}${suffix}.* `
      + 'so the previous capture is left intact');
  }
  const stepsPath = path.resolve(base + suffix + '-steps.json');
  fs.writeFileSync(stepsPath, JSON.stringify({
    title: flow.title || path.basename(flowPath, '.js'),
    steps: rec.steps,
  }));

  const built = buildPlayer({
    steps: rec.steps,
    title: flow.title || path.basename(flowPath, '.js'),
    outFile: path.resolve(base + suffix + '.html'),
  });

  let polishedVideo = null;
  if (!failure && makePolishedVideo) {
    polishedVideo = await renderVideo(built.outFile, {
      outFile: path.resolve(base + '.webm'),
    });
  }

  const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
  console.log('\nsteps captured : ' + built.steps);
  console.log('interactive    : ' + built.outFile + '  (' + mb(built.bytes) + ')');
  if (polishedVideo) console.log('video          : ' + polishedVideo.outFile);
  if (rawVideoPath) console.log('raw video      : ' + rawVideoPath);
  console.log('trace          : ' + tracePath);
  if (failure) {
    console.log('\nflow ended early: ' + failure.message);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
