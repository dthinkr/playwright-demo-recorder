#!/usr/bin/env node
/**
 * Attach mode — record a demo from a browser session someone else is driving.
 *
 * Instead of owning the browser (record.js), this taps whatever playwright-cli
 * session is already open: the agent browses normally, and drops a `snap` call
 * wherever a step belongs. Real clicks, real login state, no separate run.
 *
 *   node ctl.js start  --session view --out out/mydemo --title "..."
 *   node ctl.js snap   --say "Click search" --at "input[name=q]"
 *   node ctl.js snap   --say "Results land here"
 *   node ctl.js finish
 *
 * How it works: `playwright-cli eval` executes JS in the live page, so we
 * inject rrweb-snapshot there once and have the page POST each snapshot to a
 * short-lived local collector. Snapshots never travel back through stdout —
 * they are megabytes, and stdout is shared with the operator's console.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { buildPlayer } = require('./lib/build');

const LIB = path.join(__dirname, 'node_modules', 'rrweb-snapshot', 'dist', 'rrweb-snapshot.umd.min.cjs');
const STATE = path.join(__dirname, '.session.json');
/** Base64 characters per eval round trip. Comfortably under what one CDP
 *  response carries, while keeping a multi-MB page to a handful of trips. */
const CHUNK = 400000;

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const readState = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const writeState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));

/** Run JS in the attached page. Output is discarded: playwright-cli echoes the
 *  source it ran, and ours can be 80KB of library. */
function pageEval(session, code) {
  return execFileSync('playwright-cli', ['-s=' + session, 'eval', code], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 128 * 1024 * 1024,
  });
}

/**
 * Pull the return value out of playwright-cli's output.
 *
 * The snapshot comes back through the CDP eval channel rather than a local
 * HTTP collector: strict sites (github.com among them) set a `connect-src`
 * CSP that blocks the page from POSTing to localhost, and a recorder that
 * only works on permissive sites is not worth having.
 */
function resultOf(stdout) {
  const start = stdout.indexOf('### Result');
  if (start < 0) throw new Error('eval returned no result block');
  let body = stdout.slice(start + '### Result'.length);
  const end = body.indexOf('### Ran Playwright code');
  if (end >= 0) body = body.slice(0, end);
  body = body.trim();
  // The value arrives as a quoted, escaped string literal.
  return body.startsWith('"') ? JSON.parse(body) : body;
}

async function snap() {
  const state = readState();
  const say = opt('say', '');
  const at = opt('at', null);

  // Only ship the library when the page does not already have it — 80KB per
  // step through argv would be silly, and pages survive between snaps.
  const has = pageEval(state.session, '() => typeof window.rrwebSnapshot');
  if (!/object/.test(has)) {
    const lib = fs.readFileSync(LIB, 'utf8');
    pageEval(state.session, `() => { ${lib} ; window.rrwebSnapshot = rrwebSnapshot; return "injected"; }`);
  }

  const capture = `() => {
    const sel = ${JSON.stringify(at)};
    let hotspot = null;
    if (sel) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        hotspot = { x: r.left, y: r.top, width: r.width, height: r.height };
      }
    }
    const NOISE = ['#__demo_cursor', '#nuxt-devtools-anchor', '.nuxt-devtools-anchor', 'vite-error-overlay'];
    const hidden = [];
    NOISE.forEach((s) => document.querySelectorAll(s).forEach((el) => {
      hidden.push([el, el.style.display]); el.style.display = 'none';
    }));
    const snapshot = window.rrwebSnapshot.snapshot(document, {
      inlineStylesheet: true, inlineImages: true, recordCanvas: true,
    });
    hidden.forEach(([el, prev]) => { el.style.display = prev; });
    const payload = JSON.stringify({
      snapshot, hotspot,
      caption: ${JSON.stringify(say)},
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY },
      url: location.href,
    });
    // A real page snapshots to several MB, which is more than one eval round
    // trip carries. Gzip in the page, then hand it back in slices.
    const bytes = new TextEncoder().encode(payload);
    const gz = new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
    );
    return gz.arrayBuffer().then((buf) => {
      let bin = '';
      const view = new Uint8Array(buf);
      for (let i = 0; i < view.length; i += 8192) {
        bin += String.fromCharCode.apply(null, view.subarray(i, i + 8192));
      }
      const b64 = btoa(bin);
      window.__demoChunks = b64.match(/[\\s\\S]{1,${CHUNK}}/g) || [];
      return String(window.__demoChunks.length);
    });
  }`;

  const count = parseInt(resultOf(pageEval(state.session, capture)), 10);
  let b64 = '';
  for (let i = 0; i < count; i++) {
    b64 += resultOf(pageEval(state.session, `() => window.__demoChunks[${i}]`));
  }
  pageEval(state.session, '() => { delete window.__demoChunks; return "cleared"; }');
  const step = JSON.parse(
    zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'),
  );

  state.steps.push(step);
  writeState(state);
  const size = (JSON.stringify(step).length / 1048576).toFixed(1);
  console.log(`step ${state.steps.length}: ${step.caption || '(no caption)'}`
    + `${step.hotspot ? ' [hotspot]' : ''}  ${size} MB  ${step.url}`);
}

function finish() {
  const state = readState();
  if (!state.steps.length) {
    console.error('no steps recorded');
    process.exit(1);
  }
  const stepsFile = path.resolve(state.out + '-steps.json');
  fs.mkdirSync(path.dirname(stepsFile), { recursive: true });
  fs.writeFileSync(stepsFile, JSON.stringify({ title: state.title, steps: state.steps }));
  const built = buildPlayer({
    steps: state.steps,
    title: state.title,
    outFile: path.resolve(state.out + '.html'),
    accent: state.accent,
  });
  fs.unlinkSync(STATE);
  console.log(`\n${built.steps} steps -> ${built.outFile}  (${(built.bytes / 1048576).toFixed(1)} MB)`);
  console.log(`raw steps      -> ${stepsFile}`);
}

(async () => {
  if (cmd === 'start') {
    writeState({
      session: opt('session', 'view'),
      out: opt('out', 'out/session'),
      title: opt('title', 'Demo'),
      accent: opt('accent', undefined),
      steps: [],
    });
    console.log('recording armed. drive the browser as usual, then `ctl.js snap --say "..."`.');
  } else if (cmd === 'snap') {
    await snap();
  } else if (cmd === 'finish') {
    finish();
  } else if (cmd === 'status') {
    const s = readState();
    console.log(`session=${s.session} steps=${s.steps.length} out=${s.out}`);
  } else {
    console.error('usage: ctl.js start|snap|finish|status');
    process.exit(1);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
