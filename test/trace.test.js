/**
 * The trace decoder's failure mode is silence: a node reference that resolves
 * to the wrong subtree still yields valid HTML, just of the wrong page. These
 * tests pin the addressing scheme on a hand-built fixture, so a format change
 * or an ordering slip fails here instead of shipping a plausible-looking lie.
 */
const { after, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { stepsFromTrace } = require('../lib/trace');

const tempDirs = [];
after(() => tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

/** Build a minimal trace zip with the structure Playwright emits. */
function makeTrace(events, network = [], resources = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demorec-'));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'trace.trace'),
    events.map((e) => JSON.stringify(e)).join('\n'));
  fs.writeFileSync(path.join(dir, 'trace.network'),
    network.map((e) => JSON.stringify(e)).join('\n'));
  const resourceNames = Object.keys(resources);
  if (resourceNames.length) {
    const resourceDir = path.join(dir, 'resources');
    fs.mkdirSync(resourceDir);
    for (const [name, contents] of Object.entries(resources)) {
      fs.writeFileSync(path.join(resourceDir, name), contents);
    }
  }
  const zip = path.join(dir, 'trace.zip');
  execFileSync('zip', [
    '-q', '-r', zip, 'trace.trace', 'trace.network',
    ...(resourceNames.length ? ['resources'] : []),
  ], { cwd: dir });
  return zip;
}

const snapshotEvent = (callId, name, html, extra = {}) => ({
  type: 'frame-snapshot',
  snapshot: {
    callId, snapshotName: name, html,
    frameUrl: 'https://example.test/page',
    viewport: { width: 800, height: 600 },
    isMainFrame: true,
    ...extra,
  },
});

const beforeEvent = (callId, method, params) => ({
  type: 'before', callId, class: 'Frame', method, params,
});

/** A page with enough nodes that a wrong reference would be obvious. */
const PAGE = ['HTML', {}, ['HEAD', {}], ['BODY', {},
  ['H1', {}, 'Correct heading'],
  ['P', {}, 'First paragraph'],
  ['BUTTON', { id: 'go' }, 'Press me'],
]];

test('resolves a whole-tree reference to the previous snapshot', () => {
  const zip = makeTrace([
    snapshotEvent('call@1', 'before@call@1', PAGE),
    beforeEvent('call@1', 'click', { selector: 'button:has-text("Press me")' }),
    // [[1, k]] = "one snapshot back, node #k". Post-order over PAGE is
    // HEAD(0), 'Correct heading'(1), H1(2), 'First paragraph'(3), P(4),
    // 'Press me'(5), BUTTON(6), BODY(7), HTML(8) — the root comes last.
    snapshotEvent('call@2', 'before@call@2', [[1, 8]]),
    beforeEvent('call@2', 'click', { selector: 'button:has-text("Press me")' }),
  ]);

  const { steps } = stepsFromTrace(zip);
  assert.equal(steps.length, 2);
  for (const step of steps) {
    assert.match(step.html, /Correct heading/,
      'a reference resolved to the wrong node, or post-order addressing drifted');
    assert.match(step.html, /Press me/);
  }
});

test('post-order addressing: node index picks the intended subtree', () => {
  // Index 2 is the H1 element (its text child is 1). Addressing the parent
  // rather than the text is what a real diffed snapshot does.
  const zip = makeTrace([
    snapshotEvent('call@1', 'before@call@1', PAGE),
    beforeEvent('call@1', 'click', { selector: 'x' }),
    snapshotEvent('call@2', 'before@call@2',
      ['HTML', {}, ['BODY', {}, [[1, 2]], ['P', {}, 'Only this is new']]]),
    beforeEvent('call@2', 'click', { selector: 'x' }),
  ]);

  const { steps } = stepsFromTrace(zip);
  const second = steps[1].html;
  assert.match(second, /Correct heading/, 'reference should have pulled in the H1');
  assert.match(second, /Only this is new/);
  assert.doesNotMatch(second, /First paragraph/,
    'reference pulled in a sibling it should not have — addressing is off by one');
});

test('scripts are dropped and noscript cannot render its fallback', () => {
  const zip = makeTrace([
    snapshotEvent('call@1', 'before@call@1',
      ['HTML', {}, ['BODY', {},
        ['SCRIPT', {}, 'window.pwned = 1'],
        ['NOSCRIPT', {}, 'PLACEHOLDER TEXT'],
        ['P', {}, 'Real content here to clear the blank-page filter'],
      ]]),
    beforeEvent('call@1', 'click', { selector: 'x' }),
  ]);

  const { steps } = stepsFromTrace(zip);
  assert.doesNotMatch(steps[0].html, /window\.pwned/, 'script content must not survive');
  assert.doesNotMatch(steps[0].html, /<noscript/i,
    'a real <noscript> renders its fallback when scripts are off — it must be renamed');
  assert.match(steps[0].html, /x-noscript/);
});

test('trace stylesheets and image elements are inlined from zip resources', () => {
  const cssUrl = 'https://example.test/style.css';
  const imageUrl = 'https://example.test/logo.png';
  const zip = makeTrace([
    snapshotEvent('call@1', 'before@call@1',
      ['HTML', {},
        ['HEAD', {}, ['LINK', { rel: 'stylesheet', href: cssUrl }]],
        ['BODY', {},
          ['IMG', { src: imageUrl }],
          ['P', {}, 'Offline resource fixture'],
        ],
      ]),
    beforeEvent('call@1', 'click', { selector: 'p' }),
  ], [
    {
      snapshot: {
        request: { url: cssUrl },
        response: { content: { _sha1: 'style.css', mimeType: 'text/css' } },
      },
    },
    {
      snapshot: {
        request: { url: imageUrl },
        response: { content: { _sha1: 'logo.png', mimeType: 'image/png' } },
      },
    },
  ], {
    'style.css': 'body { color: rgb(1, 2, 3); }',
    'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });

  const { steps } = stepsFromTrace(zip);
  assert.match(steps[0].html, /<style>body \{ color: rgb\(1, 2, 3\); \}<\/style>/);
  assert.doesNotMatch(steps[0].html, /<link[^>]+stylesheet/i);
  assert.match(steps[0].html, /src="data:image\/png;base64,/);
  assert.doesNotMatch(steps[0].html, /https:\/\/example\.test\/(?:style\.css|logo\.png)/);
});

test('a click point becomes a hotspot; a bare action does not', () => {
  const zip = makeTrace([
    snapshotEvent('call@1', 'before@call@1', PAGE),
    beforeEvent('call@1', 'click', { selector: 'button:has-text("Press me")' }),
    { type: 'input', callId: 'call@1', point: { x: 120, y: 240 } },
    snapshotEvent('call@2', 'before@call@2', PAGE),
    beforeEvent('call@2', 'click', { selector: 'button:has-text("Press me")' }),
  ]);

  const { steps } = stepsFromTrace(zip);
  assert.ok(steps[0].hotspot, 'the recorded input point should produce a hotspot');
  assert.ok(steps[0].hotspot.x < 120 && steps[0].hotspot.x + steps[0].hotspot.width > 120,
    'hotspot should straddle the recorded point');
  assert.equal(steps[1].hotspot, null, 'no input event means no hotspot');
});

test('captions prefer human text from the selector over the selector itself', () => {
  const zip = makeTrace([
    snapshotEvent('call@1', 'before@call@1', PAGE),
    beforeEvent('call@1', 'click', { selector: 'button.x-9[data-t]:has-text("Save draft") >> nth=0' }),
  ]);
  const { steps } = stepsFromTrace(zip);
  assert.equal(steps[0].caption, 'Click "Save draft"');
});

test('shareable trace output masks passwords and does not echo typed values or URL secrets', () => {
  const secret = 'DUMMY_PASSWORD_DO_NOT_SHIP';
  const zip = makeTrace([
    snapshotEvent('call@1', 'before@call@1',
      ['HTML', {}, ['BODY', {},
        ['LABEL', { for: 'password' }, 'Password'],
        ['INPUT', { id: 'password', name: 'password', type: 'password', value: secret }],
        ['P', {}, 'Enough ordinary page content for a realistic account form'],
      ]], {
        frameUrl: 'https://example.test/account?access_token=DUMMY_URL_SECRET#profile',
      }),
    beforeEvent('call@1', 'fill', { selector: 'input[name="password"]', value: secret }),
  ]);

  const { steps } = stepsFromTrace(zip);
  assert.equal(steps.length, 1);
  const serialized = JSON.stringify(steps);
  assert.doesNotMatch(serialized, /DUMMY_PASSWORD_DO_NOT_SHIP/,
    'password values must not survive into steps, captions, or generated HTML');
  assert.doesNotMatch(serialized, /DUMMY_URL_SECRET/,
    'URL query/hash data must not survive into a shareable artifact');
  assert.match(steps[0].html, /value="••••••"/,
    'password fields should retain a fixed visual placeholder');
  assert.equal(steps[0].caption, 'Type into "password"');
  assert.equal(steps[0].url, 'https://example.test/account');
});

test('trace compatibility warning uses the trace producer version, not this install', () => {
  const zip = makeTrace([
    { type: 'context-options', playwrightVersion: '2.0.0' },
    snapshotEvent('call@1', 'before@call@1', PAGE),
    beforeEvent('call@1', 'click', { selector: 'button:has-text("Press me")' }),
  ]);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    stepsFromTrace(zip);
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some((message) => /2\.0\.0/.test(message)),
    'a trace from an unverified producer version should warn even when local Playwright is supported');
});

test('a decoder that stops resolving references fails loudly', () => {
  // Every reference points past the start of the trace, so none can resolve —
  // the shape a format change would take.
  const zip = makeTrace([
    snapshotEvent('call@1', 'before@call@1',
      ['HTML', {}, ['BODY', {}, [[9, 0]], [[9, 1]], [[9, 2]],
        ['P', {}, 'Padding so the blank-page filter does not hide this'],
      ]]),
    beforeEvent('call@1', 'click', { selector: 'x' }),
  ]);
  assert.throws(() => stepsFromTrace(zip), /references resolved|implausibly/);
});
