#!/usr/bin/env node
/**
 * Render a video FROM a built demo, rather than from the original browsing.
 *
 *   node video.js out/convo.html [--out out/convo.webm] [--size 1600x1000]
 *
 * Filming the player (not the app) is what makes the video watchable: it
 * already has the gliding cursor, the callouts and the dissolve between steps,
 * and its pace is ours to set. Recording the original run instead gives you
 * dead time waiting on the network and no visible pointer — the two things
 * that make agent-driven screen capture look wrong.
 *
 * Works for both capture modes, since both end at the same HTML.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
if (!src) {
  console.error('usage: node video.js <demo.html> [--out FILE.webm] [--size WxH] [--hold MS]');
  process.exit(1);
}
const opt = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const htmlPath = path.resolve(src);
const outFile = path.resolve(opt('out', htmlPath.replace(/\.html$/, '.webm')));
const [w, h] = opt('size', '1600x1000').split('x').map(Number);
/** Time the animations need before a step is worth looking at: cursor travel
 *  (0.72s) plus the callout's delayed entrance (0.34s + 0.42s). */
const SETTLE = 1250;
const BASE_HOLD = Number(opt('hold', 2200));

(async () => {
  const dir = path.dirname(outFile);
  fs.mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    recordVideo: { dir, size: { width: w, height: h } },
  });
  const page = await context.newPage();
  // 'load' never settles here: the player keeps creating iframes as it steps,
  // so the load event stays pending. The player being ready is the real signal.
  await page.goto('file://' + htmlPath, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(
    () => typeof STEPS !== 'undefined' && STEPS.length > 0,
    null,
    { timeout: 120000 },
  );

  const steps = await page.evaluate(() => STEPS.map((s) => ({ caption: s.caption || '' })));
  console.log(`filming ${steps.length} steps at ${w}x${h}`);

  // Hold the cover as a title card, then dismiss it. It is an overlay with a
  // backdrop blur: leaving it up means filming the entire walkthrough through
  // frosted glass, which is exactly what happened before this line existed.
  await page.waitForTimeout(1800);
  const coverGone = await page.evaluate(() => {
    const btn = document.getElementById('startBtn');
    if (btn) btn.click();
    const cover = document.getElementById('cover');
    cover?.classList.add('gone');
    return !cover || getComputedStyle(cover).display === 'none';
  });
  // Filming through a cover that never lifted produces a whole video shot
  // behind frosted glass — visible only if someone plays it back, which is
  // exactly why it shipped once. Fail here instead.
  if (!coverGone) {
    throw new Error('the cover overlay is still visible — refusing to film the demo through it');
  }
  await page.waitForTimeout(700);

  for (let i = 0; i < steps.length; i++) {
    if (i > 0) await page.evaluate((n) => go(n), i);
    // Hold long enough to read the callout: a flat delay rushes the wordy
    // steps and drags the terse ones.
    const readMs = BASE_HOLD + steps[i].caption.length * 38;
    await page.waitForTimeout(SETTLE + Math.min(readMs, 7000));
    console.log(`  ${i + 1}/${steps.length}  ${steps[i].caption.slice(0, 60)}`);
  }
  await page.waitForTimeout(1200); // final beat, so it does not cut dead

  const video = page.video();
  // The file is only finalised on context.close(), and closing the browser
  // discards the artifact — so save in between, never after.
  await context.close();
  if (video) await video.saveAs(outFile);
  await browser.close();

  if (video && fs.existsSync(outFile)) {
    const mb = (fs.statSync(outFile).size / 1048576).toFixed(1);
    console.log(`\nvideo -> ${outFile}  (${mb} MB)`);
  } else {
    console.error('no video was produced');
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
