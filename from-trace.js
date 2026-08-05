#!/usr/bin/env node
/**
 * Build a demo from a Playwright trace — no instrumentation, no re-run.
 *
 *   node from-trace.js out/run-trace.zip [--out out/run-from-trace] [--title "..."]
 *
 * Works on any trace recorded with `tracing.start({ snapshots: true })`,
 * including ones from CI that finished weeks ago.
 */
const path = require('path');
const fs = require('fs');
const { stepsFromTrace } = require('./lib/trace');
const { buildPlayer } = require('./lib/build');

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
if (!src) {
  console.error('usage: node from-trace.js <trace.zip> [--out DIR/NAME] [--title TEXT]');
  process.exit(1);
}
const opt = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const zipPath = path.resolve(src);
const base = opt('out', zipPath.replace(/(-trace)?\.zip$/, '-from-trace'));

const { title, steps } = stepsFromTrace(zipPath, { title: opt('title') });
if (!steps.length) {
  console.error('no actionable steps found in this trace');
  process.exit(1);
}

fs.mkdirSync(path.dirname(path.resolve(base)), { recursive: true });
fs.writeFileSync(path.resolve(base + '-steps.json'), JSON.stringify({ title, steps }));
const built = buildPlayer({
  steps,
  title,
  outFile: path.resolve(base + '.html'),
  accent: opt('accent'),
});

console.log(`${built.steps} steps -> ${built.outFile}  (${(built.bytes / 1048576).toFixed(1)} MB)`);
steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.hotspot ? '[hotspot] ' : '          '}${s.caption}`));
