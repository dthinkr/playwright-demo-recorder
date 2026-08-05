#!/usr/bin/env node
/**
 * Re-bundle a captured demo without re-driving the app.
 *
 *   node rebuild.js out/convo-steps.json [--accent '#0f766e'] [--title '...']
 *
 * Recording needs the whole stack running; restyling should not.
 */
const fs = require('fs');
const path = require('path');
const { buildPlayer } = require('./lib/build');

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
if (!src) {
  console.error('usage: node rebuild.js <steps.json> [--accent HEX] [--title TEXT]');
  process.exit(1);
}
const opt = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};

const data = JSON.parse(fs.readFileSync(path.resolve(src), 'utf8'));
const outFile = path.resolve(src.replace(/-steps\.json$/, '.html'));
const built = buildPlayer({
  steps: data.steps,
  title: opt('title') || data.title,
  outFile,
  accent: opt('accent'),
});
console.log('rebuilt: ' + built.outFile + '  (' + (built.bytes / 1048576).toFixed(1) + ' MB, '
  + built.steps + ' steps)');
