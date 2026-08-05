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

/**
 * @param {{steps: object[], title: string, outFile: string}} args
 * @returns {{outFile: string, bytes: number, steps: number}}
 */
function buildPlayer({ steps, title, outFile, accent = '#4f46e5' }) {
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const lib = fs.readFileSync(SNAPSHOT_LIB, 'utf8');

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
