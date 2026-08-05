#!/usr/bin/env node
/**
 * CLI entry: run a flow file, emit an interactive demo + a video + a trace.
 *
 *   node record.js flows/convo.js [--headed] [--out out/convo]
 *
 * A flow file exports { title, viewport?, run(recorder, page) }. Keeping the
 * flow as a committed file (rather than a one-off agent session) is the point:
 * re-running it after a UI change regenerates the demo, which is the thing
 * hosted demo tools cannot do — they need a human to re-click the extension.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { DemoRecorder } = require('./lib/recorder');
const { buildPlayer } = require('./lib/build');

async function main() {
  const args = process.argv.slice(2);
  const flowPath = args.find((a) => !a.startsWith('--'));
  if (!flowPath) {
    console.error('usage: node record.js <flow.js> [--headed] [--out DIR/NAME]');
    process.exit(1);
  }
  const headed = args.includes('--headed');
  const outArg = args[args.indexOf('--out') + 1];
  const base = args.includes('--out') && outArg
    ? outArg
    : path.join('out', path.basename(flowPath, '.js'));

  const flow = require(path.resolve(flowPath));
  const viewport = flow.viewport ?? { width: 1440, height: 900 };
  const videoDir = path.resolve(path.dirname(base), 'video');
  fs.mkdirSync(videoDir, { recursive: true });

  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: videoDir, size: viewport },
  });
  await context.tracing.start({ screenshots: true, snapshots: true });

  const page = await context.newPage();
  // Dev servers compile routes on first hit; 30s defaults are too tight to
  // record against a cold stack.
  page.setDefaultTimeout(flow.timeout ?? 120000);
  const rec = new DemoRecorder(page, flow.options);
  await rec.init();

  let failure = null;
  try {
    await flow.run(rec, page);
  } catch (err) {
    // Keep whatever was captured before the failure — a partial demo still
    // shows how far the flow got, which is the useful thing when debugging.
    failure = err;
  }

  const tracePath = path.resolve(base + '-trace.zip');
  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  await context.tracing.stop({ path: tracePath });

  const video = page.video();
  // Save between context.close() (which finalises the file) and browser.close()
  // (which discards the artifact directory).
  await context.close();
  let videoPath = null;
  if (video) {
    videoPath = path.resolve(base + '-raw.webm');
    await video.saveAs(videoPath).catch(() => { videoPath = null; });
  }
  await browser.close();

  if (rec.steps.length === 0) {
    console.error('no steps captured');
    if (failure) console.error(failure);
    process.exit(1);
  }

  // Keep the raw capture so the player can be re-themed or re-bundled without
  // driving the app again (recording needs the stack up; rebuilding does not).
  const stepsPath = path.resolve(base + '-steps.json');
  fs.writeFileSync(stepsPath, JSON.stringify({
    title: flow.title || path.basename(flowPath, '.js'),
    steps: rec.steps,
  }));

  const built = buildPlayer({
    steps: rec.steps,
    title: flow.title || path.basename(flowPath, '.js'),
    outFile: path.resolve(base + '.html'),
  });

  const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
  console.log('\nsteps captured : ' + built.steps);
  console.log('interactive    : ' + built.outFile + '  (' + mb(built.bytes) + ')');
  if (videoPath) console.log('video          : ' + videoPath);
  console.log('trace          : ' + tracePath);
  if (failure) {
    console.log('\nflow ended early: ' + failure.message);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
