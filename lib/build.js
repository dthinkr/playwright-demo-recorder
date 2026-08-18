/**
 * Bundle captured steps and the player into ONE html file. The rrweb rebuild
 * runtime is included only when at least one step is an rrweb snapshot.
 *
 * Single-file on purpose: the artifact is meant to be sent through chat,
 * issue trackers, or email and opened with no server, install, or account.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TEMPLATE = path.join(__dirname, 'player-template.html');

/** Resolve from Node's module graph so npm/pnpm hoisting does not matter. */
function browserBundle(packageName, minifiedName) {
  const entry = require.resolve(packageName);
  const minified = path.join(path.dirname(entry), minifiedName);
  return fs.existsSync(minified) ? minified : entry;
}

const SNAPSHOT_LIB = browserBundle('rrweb-snapshot', 'rrweb-snapshot.umd.min.cjs');
// Callout anchoring: flip/shift/collision handling is a solved problem and a
// hand-rolled version gets it wrong the first time a hotspot sits near an edge.
// 12KB inlined against a demo that is already ~1MB.
// The dom build's UMD wrapper expects `FloatingUICore` to already be a global,
// so core has to be inlined ahead of it. Together ~28KB.
const FLOATING_UI = [
  browserBundle('@floating-ui/core', 'floating-ui.core.umd.min.js'),
  browserBundle('@floating-ui/dom', 'floating-ui.dom.umd.min.js'),
];

// These exact license blocks travel with every generated HTML artifact. The
// rrweb browser build includes PostCSS and its small runtime dependencies.
const RRWEB_NOTICE = fs.readFileSync(
  path.join(__dirname, 'licenses', 'rrweb-notices.txt'),
  'utf8',
);
const FLOATING_NOTICE = fs.readFileSync(
  path.join(__dirname, 'licenses', 'floating-ui-notice.txt'),
  'utf8',
);

/**
 * Pull repeated bulk strings out of the step snapshots into a shared pool.
 *
 * Every snapshot inlines the whole page, so a site's images, fonts and
 * stylesheets are duplicated once per step — nine steps of a docs site came to
 * 43MB, almost all of it the same base64 blobs over and over. gzip does not
 * save us: its window is 32KB, and these copies sit megabytes apart.
 *
 * Values that appear in more than one step are replaced by a token and stored
 * once; the player substitutes them back before rebuilding.
 */
const POOL_MIN = 1500; // chars — below this the token costs more than it saves

function walkValues(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (node.attributes) {
    for (const k of Object.keys(node.attributes)) {
      const v = node.attributes[k];
      if (typeof v === 'string' && v.length >= POOL_MIN) {
        const out = fn(v);
        if (out !== undefined) node.attributes[k] = out;
      }
    }
  }
  if (typeof node.textContent === 'string' && node.textContent.length >= POOL_MIN) {
    const out = fn(node.textContent);
    if (out !== undefined) node.textContent = out;
  }
  if (Array.isArray(node.childNodes)) node.childNodes.forEach((c) => walkValues(c, fn));
}

function poolAssets(steps) {
  const counts = new Map();
  steps.forEach((s) => walkValues(s.snapshot, (v) => {
    counts.set(v, (counts.get(v) || 0) + 1);
  }));

  const pool = [];
  const ids = new Map();
  counts.forEach((n, v) => {
    if (n > 1) { ids.set(v, pool.length); pool.push(v); }
  });
  if (!pool.length) return pool;

  steps.forEach((s) => walkValues(s.snapshot, (v) => (
    ids.has(v) ? '__ASSET_' + ids.get(v) + '__' : undefined
  )));
  return pool;
}

/**
 * @param {{steps: object[], title: string, outFile: string}} args
 * @returns {{outFile: string, bytes: number, steps: number}}
 */
function buildPlayer({ steps, title, outFile, accent = '#4f46e5' }) {
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const needsSnapshotRuntime = steps.some((step) => step && step.snapshot);
  const lib = needsSnapshotRuntime
    ? RRWEB_NOTICE + '\n' + fs.readFileSync(SNAPSHOT_LIB, 'utf8')
    : '';
  const floating = FLOATING_NOTICE + '\n'
    + FLOATING_UI.map((f) => fs.readFileSync(f, 'utf8')).join('\n;\n');

  // Serialized DOM is highly repetitive, so gzip takes a multi-MB capture down
  // by roughly an order of magnitude. Base64 costs a third of that back and
  // buys an artifact that is plain ASCII inside a <script> block \u2014 no escaping
  // hazards from captured markup, and small enough to email.
  // Deep-copy first: pooling rewrites the snapshots in place, and the caller
  // may still want its own objects (rebuild.js reads the same file twice).
  const work = JSON.parse(JSON.stringify(steps));
  const assets = poolAssets(work);
  const raw = Buffer.from(JSON.stringify({ steps: work, assets }), 'utf8');
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
