const { test } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');

const { DemoRecorder } = require('../lib/recorder');

test('hotspot coordinates remain viewport-relative after the page scrolls', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(`
    <style>
      html, body { margin: 0; }
      .spacer { height: 1000px; }
      #target { display: block; width: 160px; height: 48px; }
      .tail { height: 1000px; }
    </style>
    <div class="spacer"></div>
    <button id="target">Continue</button>
    <div class="tail"></div>
  `);
  await page.evaluate(() => window.scrollTo(0, 800));

  const expected = await page.locator('#target').boundingBox();
  assert.ok(expected, 'fixture button should have a bounding box');
  assert.ok(await page.evaluate(() => window.scrollY > 0), 'fixture should be scrolled');

  const recorder = new DemoRecorder(page, { cursorTravel: 0, settle: 0 });
  await recorder.init();
  assert.equal(await page.evaluate(() => typeof window.rrwebSnapshot?.snapshot), 'function',
    'the resolved rrweb UMD bundle should inject into the page');
  const hotspot = await recorder._rectOf('#target');

  assert.deepEqual(hotspot, expected,
    'Playwright boundingBox() already returns viewport coordinates');
});

test('flow snapshots mask passwords and strip secret-bearing URL metadata', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.route('https://example.test/**', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<html><body><input type="password" value="DUMMY_PASSWORD_DO_NOT_SHIP"></body></html>',
  }));
  await page.goto('https://example.test/account?access_token=DUMMY_URL_SECRET#profile');
  // rrweb masks the live property, but an emptied field can still retain the
  // original HTML value attribute. That stale attribute must not escape.
  await page.locator('input[type="password"]').evaluate((input) => { input.value = ''; });

  const recorder = new DemoRecorder(page, { settle: 0 });
  await recorder.init();
  await recorder.note('Show the account page');

  const serialized = JSON.stringify(recorder.steps);
  assert.doesNotMatch(serialized, /DUMMY_PASSWORD_DO_NOT_SHIP/);
  assert.match(serialized, /"value":"••••••"/,
    'password masking should not reveal the original value length');
  assert.doesNotMatch(serialized, /DUMMY_URL_SECRET/);
  assert.equal(recorder.steps[0].url, 'https://example.test/account');
});
