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
 * inject rrweb-snapshot there once and pull each compressed snapshot through
 * the CDP eval result in chunks.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { buildPlayer } = require('./lib/build');
const { sanitizeStep } = require('./lib/sanitize');

const LIB = require.resolve('rrweb-snapshot');
const STATE = path.join(process.cwd(), '.session.json');
/** Base64 characters per eval round trip. Comfortably under what one CDP
 *  response carries, while keeping a multi-MB page to a handful of trips. */
const CHUNK = 400000;

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const readState = () => {
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  state.steps = (state.steps || []).map(sanitizeStep);
  return state;
};
const writeState = (s) => fs.writeFileSync(STATE, JSON.stringify({
  ...s,
  steps: (s.steps || []).map(sanitizeStep),
}, null, 2));

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
      maskInputFn: () => '••••••',
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
  const step = sanitizeStep(JSON.parse(
    zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'),
  ));

  state.steps.push(step);
  writeState(state);
  const size = (JSON.stringify(step).length / 1048576).toFixed(1);
  console.log(`step ${state.steps.length}: ${step.caption || '(no caption)'}`
    + `${step.hotspot ? ' [hotspot]' : ''}  ${size} MB  ${step.url}`);
}

async function finish() {
  let state = readState();
  if (state.auto) {
    // Tell the watcher to stop, then let it flush what is still buffered
    // before we read the session file it is writing to.
    fs.writeFileSync(STOP, '');
    try { state.steps.push(...drainAuto(state.session)); } catch (e) { /* session gone */ }
    await sleep(1600);
    const latest = readState();
    // The watcher may have appended while we drained; keep whichever has more.
    if (latest.steps.length > state.steps.length) state = latest;
  }
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

/**
 * Auto mode: arm the page once, then let whoever is driving just drive.
 *
 * A click listener in the page captures the snapshot and the clicked element's
 * rect at the moment of the click, and buffers it. No `snap` call per step, no
 * cooperation from the agent — it browses as usual and the steps accumulate.
 * Captions default to the element's own label, which is usually the right
 * sentence already ("Click 'Issues'").
 *
 * Buffered in the page rather than pulled per click because pulling is a
 * multi-second round trip; doing that inline would change the timing of the
 * very session we are trying to observe.
 */
function armAuto(session) {
  const lib = fs.readFileSync(LIB, 'utf8');
  const arm = `() => {
    if (!window.rrwebSnapshot) { ${lib} ; window.rrwebSnapshot = rrwebSnapshot; }
    if (window.__demoAuto) return 'already armed';
    window.__demoBuf = window.__demoBuf || [];
    const label = (el) => {
      const t = (el.getAttribute('aria-label') || el.innerText
        || el.getAttribute('placeholder') || el.getAttribute('name') || '').trim();
      return t ? t.replace(/\\s+/g, ' ').slice(0, 60) : el.tagName.toLowerCase();
    };
    const grab = (target) => {
      try {
        const el = target && target.closest
          ? (target.closest('a,button,input,textarea,select,[role=button],[role=link]') || target)
          : null;
        let hotspot = null;
        if (el && el.getBoundingClientRect) {
          const r = el.getBoundingClientRect();
          if (r.width && r.height) {
            hotspot = { x: r.left, y: r.top, width: r.width, height: r.height };
          }
        }
        const snapshot = window.rrwebSnapshot.snapshot(document, {
          inlineStylesheet: true, inlineImages: true, recordCanvas: true,
          maskInputFn: () => '••••••',
        });
        window.__demoBuf.push({
          snapshot, hotspot,
          caption: el ? 'Click "' + label(el) + '"'
            : (document.title || location.pathname).slice(0, 70),
          viewport: { width: innerWidth, height: innerHeight },
          scroll: { x: scrollX, y: scrollY },
          url: location.href,
        });
      } catch (e) { /* one lost step must not break the session */ }
    };
    // Capture phase: fires before the app's own handler mutates the DOM, so the
    // snapshot is the state the user was looking at when they clicked.
    document.addEventListener('click', (e) => grab(e.target), true);
    window.__demoGrab = grab;
    window.__demoAuto = true;
    return 'armed';
  }`;
  return resultOf(pageEval(session, arm));
}

/** Drain the in-page buffer, gzipped and chunked (see snap() for why). */
function drainAuto(session) {
  const n = parseInt(resultOf(pageEval(session,
    '() => String((window.__demoBuf || []).length)')), 10);
  if (!n) return [];
  const steps = [];
  for (let i = 0; i < n; i++) {
    const count = parseInt(resultOf(pageEval(session, `() => {
      const bytes = new TextEncoder().encode(JSON.stringify(window.__demoBuf[${i}]));
      return new Response(new Blob([bytes]).stream()
        .pipeThrough(new CompressionStream('gzip'))).arrayBuffer().then((buf) => {
          let bin = ''; const v = new Uint8Array(buf);
          for (let k = 0; k < v.length; k += 8192) {
            bin += String.fromCharCode.apply(null, v.subarray(k, k + 8192));
          }
          window.__demoChunks = btoa(bin).match(/[\\s\\S]{1,${CHUNK}}/g) || [];
          return String(window.__demoChunks.length);
        });
    }`)), 10);
    let b64 = '';
    for (let c = 0; c < count; c++) {
      b64 += resultOf(pageEval(session, `() => window.__demoChunks[${c}]`));
    }
    steps.push(sanitizeStep(JSON.parse(
      zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'),
    )));
    process.stdout.write(`  pulled step ${i + 1}/${n}\r`);
  }
  pageEval(session, '() => { window.__demoBuf = []; delete window.__demoChunks; return "cleared"; }');
  console.log('');
  return steps;
}

const STOP = path.join(process.cwd(), '.stop');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Watch loop for auto mode.
 *
 * A navigation destroys the page context, taking the injected listener and the
 * buffered steps with it — so arming once is not enough. This re-arms whenever
 * the page comes up bare, and drains the buffer to disk as it fills, which also
 * keeps multi-MB snapshots from piling up in page memory.
 */
async function watch() {
  fs.existsSync(STOP) && fs.unlinkSync(STOP);
  let armedSeen = 0;
  let lastUrl = null;
  while (!fs.existsSync(STOP)) {
    try {
      const state = readState();
      const armed = /true/.test(
        resultOf(pageEval(state.session, '() => String(!!window.__demoAuto)')),
      );
      if (!armed) {
        armAuto(state.session);
        if (armedSeen++) console.log('re-armed after navigation');
      }
      // A click that navigates loses its buffered snapshot: the page is torn
      // down before any poll can drain it. So also capture on arrival — the
      // landed page becomes its own step. In-page clicks (dialogs, tabs,
      // filters) still come through the listener with their hotspot intact.
      const here = resultOf(pageEval(state.session, '() => location.href'));
      if (here && here !== lastUrl) {
        if (lastUrl !== null) {
          pageEval(state.session, '() => { window.__demoGrab && window.__demoGrab(null); return "grabbed"; }');
        }
        lastUrl = here;
      }

      const pending = parseInt(
        resultOf(pageEval(state.session, '() => String((window.__demoBuf || []).length)')), 10,
      );
      if (pending > 0) {
        const fresh = drainAuto(state.session);
        const next = readState();
        next.steps.push(...fresh);
        writeState(next);
        console.log(`captured ${fresh.length} step(s) — ${next.steps.length} total`);
      }
    } catch (e) {
      // The session can disappear mid-run; keep watching rather than dying.
    }
    await sleep(1200);
  }
  fs.existsSync(STOP) && fs.unlinkSync(STOP);
  console.log('watcher stopped');
}

(async () => {
  if (cmd === 'auto') {
    // One command in, a recording out: arm, browse, finish.
    const session = opt('session', 'view');
    writeState({
      session,
      out: opt('out', 'out/session'),
      title: opt('title', 'Demo'),
      accent: opt('accent', undefined),
      auto: true,
      steps: [],
    });
    console.log(armAuto(session) + ' on session "' + session + '".');
    console.log('browse and click as usual, then: node ctl.js finish');
    console.log('watching (re-arms across navigations)...');
    await watch();
  } else if (cmd === 'start') {
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
    await finish();
  } else if (cmd === 'status') {
    const s = readState();
    console.log(`session=${s.session} steps=${s.steps.length} out=${s.out}`);
  } else {
    console.error('usage: ctl.js start|auto|snap|finish|status');
    process.exit(1);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
