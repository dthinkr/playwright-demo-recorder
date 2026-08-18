/**
 * Guards for two failures that already shipped once, both silent:
 *
 *   1. The trace exporter looked correct while inlining nothing — the test
 *      machine could reach the live site, so the demo rendered fine and would
 *      have been a blank frame on anyone else's laptop.
 *   2. Steps are gzipped into the artifact; a lossy round trip would corrupt
 *      pages in ways nobody notices until a viewer opens it.
 *
 * Both are cheap to assert and impossible to eyeball, which is exactly the
 * combination that earns a test.
 */
const { after, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { buildPlayer } = require('../lib/build');

const tempDirs = [];
after(() => tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demorec-'));
  tempDirs.push(dir);
  return path.join(dir, 'demo.html');
};

/** Pull the steps back out of a built artifact, the way the player does. */
function payloadOf(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const b64 = (html.match(/const STEPS_B64 = "([A-Za-z0-9+/=]*)"/) || [])[1];
  assert.ok(b64, 'built artifact should carry a base64 payload');
  return JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
}

const rrwebStep = (extra = {}) => ({
  snapshot: {
    type: 0,
    childNodes: [{
      type: 2, tagName: 'html', attributes: {}, id: 1,
      childNodes: [{ type: 3, textContent: 'hello', id: 2 }],
    }],
    id: 0,
  },
  caption: 'a step',
  url: 'https://example.test/',
  viewport: { width: 800, height: 600 },
  scroll: { x: 0, y: 0 },
  hotspot: null,
  ...extra,
});

test('the gzipped payload round-trips losslessly', () => {
  const steps = [rrwebStep(), rrwebStep({ caption: 'another' })];
  const out = tmp();
  buildPlayer({ steps, title: 'T', outFile: out });
  const { steps: back } = payloadOf(out);
  assert.deepEqual(back, steps, 'steps must survive the gzip round trip unchanged');
});

test('bulk values repeated across steps are pooled, and the pool restores them', () => {
  // A big value in two steps is the case pooling exists for: gzip cannot help,
  // its window is far smaller than the distance between the copies.
  const big = 'data:image/png;base64,' + 'A'.repeat(4000);
  const withImage = () => rrwebStep({
    snapshot: {
      type: 0,
      childNodes: [{
        type: 2, tagName: 'img', attributes: { src: big }, id: 1, childNodes: [],
      }],
      id: 0,
    },
  });
  const out = tmp();
  buildPlayer({ steps: [withImage(), withImage()], title: 'T', outFile: out });
  const payload = payloadOf(out);

  assert.ok(payload.assets && payload.assets.length === 1,
    'the repeated value should be stored once');
  const token = payload.steps[0].snapshot.childNodes[0].attributes.src;
  assert.match(token, /^__ASSET_\d+__$/, 'the step should hold a token, not the value');
  assert.equal(payload.assets[+token.match(/\d+/)[0]], big,
    'the pool must hold the original value so the player can restore it');
});

test('already-inlined trace HTML survives player bundling without remote assets', () => {
  const steps = [{
    html: '<!DOCTYPE html><html><head><style>body{color:red}</style></head>'
      + '<body><img src="data:image/png;base64,AAAA"><p>hi</p></body></html>',
    caption: 'a step',
    url: 'https://example.test/',
    viewport: { width: 800, height: 600 },
    scroll: { x: 0, y: 0 },
    hotspot: null,
  }];
  const out = tmp();
  buildPlayer({ steps, title: 'T', outFile: out });
  const { steps: back } = payloadOf(out);

  assert.doesNotMatch(back[0].html, /<link[^>]+rel=["']?stylesheet/i,
    'a remote stylesheet link means the demo needs the network to look right');
  const remoteImg = back[0].html.match(/<img[^>]+src=["']https?:\/\//i);
  assert.equal(remoteImg, null,
    'images must be inlined; a remote src is a blank frame on someone else\'s machine');
});

test('captured markup containing </script> cannot break out of the payload', () => {
  const steps = [rrwebStep({
    snapshot: {
      type: 0,
      childNodes: [{
        type: 2, tagName: 'div', attributes: {}, id: 1,
        childNodes: [{ type: 3, textContent: '</script><script>alert(1)</script>', id: 2 }],
      }],
      id: 0,
    },
  })];
  const out = tmp();
  buildPlayer({ steps, title: 'T', outFile: out });
  const html = fs.readFileSync(out, 'utf8');
  // Base64 cannot contain a closing tag, so the payload is inert by
  // construction — assert that rather than trusting it.
  const payloadBlock = html.match(/const STEPS_B64 = "([^"]*)"/)[1];
  assert.doesNotMatch(payloadBlock, /<\/script/i);
  assert.deepEqual(payloadOf(out).steps, steps, 'the content still round-trips intact');
});

test('generated demos retain the licenses for bundled browser runtimes', () => {
  const out = tmp();
  buildPlayer({ steps: [rrwebStep()], title: 'T', outFile: out });
  const html = fs.readFileSync(out, 'utf8');

  assert.match(html, /rrweb-snapshot[\s\S]*Copyright \(c\) 2018[\s\S]*MIT License/);
  assert.match(html, /PostCSS[\s\S]*Copyright 2013 Andrey Sitnik/);
  assert.match(html, /Nano ID[\s\S]*Copyright 2017 Andrey Sitnik/);
  assert.match(html, /picocolors[\s\S]*ISC License/);
  assert.match(html, /source-map-js[\s\S]*Mozilla Foundation[\s\S]*BSD 3-Clause/);
  assert.match(html, /Floating UI[\s\S]*Copyright \(c\) 2021-present[\s\S]*MIT License/);
});
