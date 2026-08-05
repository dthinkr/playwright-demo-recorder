/**
 * Bundle captured steps + the rrweb rebuild lib + the player into ONE html file.
 *
 * Self-contained on purpose: the artifact is meant to be sent to someone (Slack,
 * Wrike, email) and opened with no server, no install, no account. That is the
 * whole point over a hosted demo tool.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TEMPLATE = path.join(__dirname, 'player-template.html');
// See recorder.js — dist/ is not exported, and we want the file as text anyway.
const SNAPSHOT_LIB = path.join(
  __dirname, '..', 'node_modules', 'rrweb-snapshot', 'dist', 'rrweb-snapshot.umd.min.cjs',
);
// Callout anchoring: flip/shift/collision handling is a solved problem and a
// hand-rolled version gets it wrong the first time a hotspot sits near an edge.
// 12KB inlined against a demo that is already ~1MB.
// The dom build's UMD wrapper expects `FloatingUICore` to already be a global,
// so core has to be inlined ahead of it. Together ~28KB.
const FLOATING_UI = [
  path.join(__dirname, '..', 'node_modules', '@floating-ui', 'core', 'dist', 'floating-ui.core.umd.min.js'),
  path.join(__dirname, '..', 'node_modules', '@floating-ui', 'dom', 'dist', 'floating-ui.dom.umd.min.js'),
];

/**
 * @param {{steps: object[], title: string, outFile: string}} args
 * @returns {{outFile: string, bytes: number, steps: number}}
 */
function buildPlayer({ steps, title, outFile, accent = '#4f46e5' }) {
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const lib = fs.readFileSync(SNAPSHOT_LIB, 'utf8');
  const floating = FLOATING_UI.map((f) => fs.readFileSync(f, 'utf8')).join('\n;\n');

  // Serialized DOM is highly repetitive, so gzip takes a multi-MB capture down
  // by roughly an order of magnitude. Base64 costs a third of that back and
  // buys an artifact that is plain ASCII inside a <script> block \u2014 no escaping
  // hazards from captured markup, and small enough to email.
  const raw = Buffer.from(JSON.stringify(steps), 'utf8');
  const gz = zlib.gzipSync(raw, { level: 9 });
  // Losslessness is the whole promise here, so prove it at build time rather
  // than trusting it: a corrupted artifact would only surface in someone
  // else's browser, long after the recording session is over.
  if (!zlib.gunzipSync(gz).equals(raw)) {
    throw new Error('gzip round-trip mismatch \u2014 refusing to emit a corrupt demo');
  }
  const payload = gz.toString('base64');

  const html = template
    .split('__TITLE__').join(escapeHtml(title))
    .split('__ACCENT__').join(accent)
    // Halo / dot glow, derived so callers only ever pass one colour.
    .split('__ACCENT_SOFT__').join(hexToRgba(accent, 0.22))
    .replace('__RRWEB_SNAPSHOT__', () => lib)
    .replace('__FLOATING_UI__', () => floating)
    .replace('__STEPS_B64__', () => payload);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html);
  return {
    outFile,
    bytes: Buffer.byteLength(html),
    steps: steps.length,
    rawBytes: raw.length,
  };
}

function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
  if (!m) return 'rgba(79,70,229,' + alpha + ')';
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

module.exports = { buildPlayer };
