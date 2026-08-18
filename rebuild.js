#!/usr/bin/env node
/**
 * Re-bundle a captured demo without re-driving the app.
 *
 *   node rebuild.js out/convo-steps.json [--out out/convo.html]
 *     [--accent '#0f766e'] [--title '...']
 *
 * Recording needs the whole stack running; restyling should not.
 */
const fs = require('fs');
const path = require('path');
const { buildPlayer } = require('./lib/build');

const args = process.argv.slice(2);
const valueOptions = new Set(['accent', 'out', 'title']);
const positional = [];
for (let i = 0; i < args.length; i++) {
  const name = args[i].startsWith('--') ? args[i].slice(2) : null;
  if (name && valueOptions.has(name)) { i++; continue; }
  if (!name) positional.push(args[i]);
}
const src = positional[0];
if (!src) {
  console.error('usage: node rebuild.js <steps.json> [--out FILE.html] [--accent HEX] [--title TEXT]');
  process.exit(1);
}
const opt = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};

const srcPath = path.resolve(src);
const data = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
const defaultOut = /-steps\.json$/i.test(srcPath)
  ? srcPath.replace(/-steps\.json$/i, '.html')
  : srcPath.replace(/\.json$/i, '') + '.html';
const outFile = path.resolve(opt('out') || defaultOut);
if (outFile === srcPath) {
  throw new Error('rebuild output must differ from the source JSON path');
}
const built = buildPlayer({
  steps: data.steps,
  title: opt('title') || data.title,
  outFile,
  accent: opt('accent'),
});
console.log('rebuilt: ' + built.outFile + '  (' + (built.bytes / 1048576).toFixed(1) + ' MB, '
  + built.steps + ' steps)');
