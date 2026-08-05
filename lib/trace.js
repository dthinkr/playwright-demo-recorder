/**
 * Build demo steps out of a Playwright trace, with no page instrumentation.
 *
 * Playwright already records everything a walkthrough needs and we were
 * re-collecting all of it from the outside:
 *
 *   frame-snapshot  ->  serialized DOM, viewport, url; one taken BEFORE every
 *                       action, which is exactly the step semantics we
 *                       hand-rolled (capture, then act)
 *   input.point     ->  the click coordinates we were computing via boundingBox
 *   before/after    ->  the action and its selector, i.e. the caption
 *
 * So this path needs no injection, no CSP workaround, no chunked transport and
 * no re-arming after navigation — every one of those exists only because the
 * attach mode cannot see inside the browser. It also works on traces recorded
 * months ago, including CI runs.
 *
 * The snapshot format is Playwright's own and undocumented; the decoding below
 * follows their trace-viewer service worker (playwright-core/lib/vite/
 * traceViewer/sw.bundle.js). That is the risk of doing this outside their repo
 * — inside it, the format is a first-class citizen.
 */
const { execFileSync } = require('child_process');

const isRef = (n) => Array.isArray(n) && Array.isArray(n[0]);
const isElement = (n) => Array.isArray(n) && typeof n[0] === 'string';

/** Void elements, which must not be given a closing tag. */
const VOID = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT',
  'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR']);

/**
 * Node list in the order references address, which is POST-ORDER: children
 * before their parent. Getting this wrong silently resolves references to the
 * wrong subtree, so it mirrors their `m()` exactly.
 */
function flatten(snapshot) {
  if (snapshot._nodes) return snapshot._nodes;
  const nodes = [];
  const visit = (n) => {
    if (typeof n === 'string') { nodes.push(n); return; }
    if (isElement(n)) {
      const [, , ...children] = n;
      for (const c of children) visit(c);
      nodes.push(n);
    }
  };
  visit(snapshot.html);
  snapshot._nodes = nodes;
  return nodes;
}

const escapeText = (s) => String(s).replace(/[&<>]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escapeAttr = (s) => String(s).replace(/[&"]/g, (c) => (
  { '&': '&amp;', '"': '&quot;' }[c]));

/** One entry per file in the trace zip, read lazily — traces run to 60MB+. */
function zipReader(zipPath) {
  const cache = new Map();
  return {
    text(entry) {
      if (!cache.has(entry)) {
        try {
          cache.set(entry, execFileSync('unzip', ['-p', zipPath, entry],
            { maxBuffer: 512 * 1024 * 1024 }));
        } catch (e) { cache.set(entry, null); }
      }
      const buf = cache.get(entry);
      return buf ? buf.toString('utf8') : null;
    },
    buffer(entry) {
      try {
        return execFileSync('unzip', ['-p', zipPath, entry],
          { maxBuffer: 512 * 1024 * 1024 });
      } catch (e) { return null; }
    },
  };
}

function parseJsonl(text) {
  const out = [];
  if (!text) return out;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* partial trailing line */ }
  }
  return out;
}

/**
 * Render one snapshot to standalone HTML, inlining what the page needs to look
 * right offline: stylesheets become <style>, images become data URIs.
 */
function renderSnapshot(snapshots, index, resources, zip) {
  const out = [];
  const snapshot = snapshots[index];
  const base = snapshot.frameUrl || '';

  const absolute = (url) => {
    try { return new URL(url, base).toString(); } catch (e) { return url; }
  };

  const inline = (url) => {
    const res = resources.get(absolute(url));
    if (!res || !res.sha1) return null;
    const buf = zip.buffer('resources/' + res.sha1);
    if (!buf) return null;
    const mime = (res.mimeType || 'application/octet-stream').split(';')[0];
    return { mime, buf };
  };

  const walk = (node, snapshotIndex, parentTag) => {
    if (typeof node === 'string') {
      // Inside <style> the text is CSS, not markup — escaping it would break it.
      out.push(parentTag === 'STYLE' ? node : escapeText(node));
      return;
    }
    if (isRef(node)) {
      const target = snapshotIndex - node[0][0];
      if (target >= 0 && target <= snapshotIndex) {
        const nodes = flatten(snapshots[target]);
        const i = node[0][1];
        if (i >= 0 && i < nodes.length) walk(nodes[i], target, parentTag);
      }
      return;
    }
    if (!isElement(node)) return;

    const [tag, attrs, ...children] = node;
    const TAG = tag.toUpperCase();
    // Scripts are dropped outright, and <noscript> is renamed so the browser
    // does not render its fallback content — the trick Playwright uses, and a
    // cleaner answer than hiding it with CSS afterwards.
    if (TAG === 'SCRIPT') return;
    const name = TAG === 'NOSCRIPT' ? 'x-noscript' : tag;

    // A stylesheet link is useless offline; swap it for its content.
    if (TAG === 'LINK' && /stylesheet/i.test((attrs || {}).rel || '')) {
      const got = inline((attrs || {}).href || '');
      if (got) {
        out.push('<style>', got.buf.toString('utf8'), '</style>');
        return;
      }
    }

    out.push('<', name);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (/^on/i.test(key)) continue;                       // no handlers
      let k = key;
      let v = value;
      const lower = key.toLowerCase();
      if ((TAG === 'IFRAME' || TAG === 'FRAME') && ['src', 'srcdoc', 'sandbox'].includes(lower)) {
        k = '__frozen_' + lower;                            // keep frames inert
      } else if (TAG === 'IMG' && lower === 'src') {
        const got = inline(value);
        if (got) v = 'data:' + got.mime + ';base64,' + got.buf.toString('base64');
        else v = absolute(value);
      } else if (lower === 'srcset') {
        continue;                                            // resolved via src
      } else if (['href', 'src'].includes(lower)) {
        v = absolute(value);
      }
      out.push(' ', k, '="', escapeAttr(v), '"');
    }
    out.push('>');
    for (const c of children) walk(c, snapshotIndex, TAG);
    if (!VOID.has(TAG)) out.push('</', name, '>');
  };

  walk(snapshot.html, index, undefined);
  const doctype = snapshot.doctype ? `<!DOCTYPE ${snapshot.doctype}>` : '<!DOCTYPE html>';
  return doctype + out.join('');
}

/**
 * Turn an action into a readable caption.
 *
 * Selectors are written for machines, so the useful part is dug out of them:
 * a `has-text("Trace viewer")` or a role name reads as a caption, the CSS
 * scaffolding around it does not. Falls back to the bare verb rather than
 * printing a selector at the viewer.
 */
function captionFor(action) {
  const method = (action.method || '').replace(/^.*\./, '');
  const verb = {
    click: 'Click', dblclick: 'Double-click', fill: 'Type into',
    type: 'Type', press: 'Press', keyboardPress: 'Press', goto: 'Open',
    check: 'Tick', selectOption: 'Choose',
  }[method];
  if (!verb) return null;

  const params = action.params || {};
  if (method === 'goto') return `Open ${String(params.url || '').replace(/^https?:\/\//, '')}`;
  if (method === 'keyboardPress') return `Press ${params.key || ''}`.trim();

  const selector = String(params.selector || '');
  // Prefer human-facing text baked into the selector over the selector itself.
  const text = (selector.match(/has-text\("([^"]+)"\)/)
    || selector.match(/\[name="([^"]+)"\]/)
    || selector.match(/text=["']?([^"'>\]]+)/) || [])[1];
  const label = text ? `"${text.trim()}"` : '';
  if (method === 'type' || method === 'fill') {
    const typed = params.text || params.value || '';
    return typed ? `Type "${String(typed).slice(0, 40)}"` : `${verb} ${label}`.trim();
  }
  return label ? `${verb} ${label}` : verb;
}

/**
 * @param {string} zipPath  a trace.zip produced with tracing.start({snapshots:true})
 * @returns {{title: string, steps: object[]}}
 */
function stepsFromTrace(zipPath, { title } = {}) {
  const zip = zipReader(zipPath);
  const events = parseJsonl(zip.text('trace.trace'));
  const network = parseJsonl(zip.text('trace.network'));

  // url -> stored body, so stylesheets and images can be inlined.
  // Entries are wrapped in `.snapshot`, and `_sha1` already carries the file
  // extension it was stored under (`<hash>.css`), so it is the entry name.
  const resources = new Map();
  for (const row of network) {
    const entry = row.snapshot || row;
    const url = (entry.request || {}).url;
    const content = (entry.response || {}).content || {};
    if (url && content._sha1) {
      resources.set(url, { sha1: content._sha1, mimeType: content.mimeType });
    }
  }

  const snapshots = events.filter((e) => e.type === 'frame-snapshot')
    .map((e) => e.snapshot)
    .filter((s) => s.isMainFrame !== false);
  if (!snapshots.length) {
    throw new Error('no frame snapshots in this trace — record with tracing.start({ snapshots: true })');
  }

  const actions = new Map();
  for (const e of events) {
    if (e.type === 'before' && e.callId) actions.set(e.callId, e);
  }
  const clickPoints = new Map();
  for (const e of events) {
    if (e.type === 'input' && e.callId && e.point) clickPoints.set(e.callId, e.point);
  }

  // One step per action-time snapshot: that frame is the state the user saw
  // when the action fired, and the click point belongs to it.
  const steps = [];
  snapshots.forEach((snapshot, index) => {
    // Names are `before@call@10`, not a bare `before`.
    if (!/^before@/.test(snapshot.snapshotName || '')) return;
    const action = actions.get(snapshot.callId);
    const caption = action ? captionFor(action) : null;
    if (!caption) return;
    // The click point is recorded against the same call, on its `input`
    // snapshot rather than the `before` one.
    const point = clickPoints.get(snapshot.callId);
    steps.push({
      html: renderSnapshot(snapshots, index, resources, zip),
      caption,
      url: snapshot.frameUrl || '',
      viewport: snapshot.viewport || { width: 1280, height: 720 },
      scroll: { x: 0, y: 0 },
      // A recorded click is a point, not a box; give it enough area to aim at.
      hotspot: point ? { x: point.x - 14, y: point.y - 14, width: 28, height: 28 } : null,
    });
  });

  return { title: title || 'Recorded from a Playwright trace', steps };
}

module.exports = { stepsFromTrace };
