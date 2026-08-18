#!/usr/bin/env node
/**
 * Render a video FROM a built demo, rather than from the original browsing.
 *
 *   node video.js out/convo.html [--out out/convo.webm] [--size 1600x1000]
 *
 * Filming the player (not the app) is what makes the video watchable: it
 * already has the gliding cursor, the callouts and the dissolve between steps,
 * and its pace is ours to set. Recording the original run instead gives you
 * dead time waiting on the network and no visible pointer.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const SETTLE = 1250;

function parseSize(value) {
  const match = /^(\d+)x(\d+)$/.exec(String(value));
  if (!match) throw new Error(`invalid video size "${value}"; expected WxH`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 1 || height < 1) throw new Error('video dimensions must be positive');
  return { width, height };
}

/**
 * Film a generated player and keep only the requested final artifact.
 * Playwright always records to its own page@*.webm first, so that intermediate
 * file lives in a temporary directory and is removed after saveAs().
 *
 * @param {string} src
 * @param {{outFile?: string, size?: string, hold?: number, logger?: Console}} options
 * @returns {Promise<{outFile: string, bytes: number, steps: number}>}
 */
async function renderVideo(src, options = {}) {
  const htmlPath = path.resolve(src);
  if (!options.outFile && !/\.html$/i.test(htmlPath)) {
    throw new Error('video source must end in .html when --out is not specified');
  }
  const outFile = path.resolve(options.outFile || htmlPath.replace(/\.html$/i, '.webm'));
  if (outFile === htmlPath) {
    throw new Error('video --out must differ from the input HTML path');
  }
  const { width, height } = parseSize(options.size || '1600x1000');
  const baseHold = Number(options.hold ?? 2200);
  if (!Number.isFinite(baseHold) || baseHold < 0) {
    throw new Error('video hold must be a non-negative number');
  }
  if (!fs.existsSync(htmlPath)) throw new Error(`demo HTML does not exist: ${htmlPath}`);

  const logger = options.logger || console;
  const outDir = path.dirname(outFile);
  fs.mkdirSync(outDir, { recursive: true });
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-recorder-video-'));

  let browser = null;
  let context = null;
  try {
    browser = await chromium.launch();
    context = await browser.newContext({
      viewport: { width, height },
      recordVideo: { dir: artifactDir, size: { width, height } },
    });
    const page = await context.newPage();
    // pathToFileURL handles Windows drive letters plus spaces, #, % and ? in
    // paths. String concatenation silently treats those characters as URL
    // syntax and can point Chromium at a different file.
    await page.goto(pathToFileURL(htmlPath).href, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    await page.waitForFunction(
      () => typeof STEPS !== 'undefined' && STEPS.length > 0,
      null,
      { timeout: 120000 },
    );

    const steps = await page.evaluate(() => STEPS.map((step) => ({
      caption: step.caption || '',
    })));
    logger.log(`filming ${steps.length} steps at ${width}x${height}`);

    // Hold the cover as a title card, then dismiss it. It is an overlay with a
    // backdrop blur, so leaving it up ruins an otherwise valid recording.
    await page.waitForTimeout(1800);
    const coverGone = await page.evaluate(() => {
      const button = document.getElementById('startBtn');
      if (button) button.click();
      const cover = document.getElementById('cover');
      cover?.classList.add('gone');
      return !cover || getComputedStyle(cover).display === 'none';
    });
    if (!coverGone) {
      throw new Error('the cover overlay is still visible — refusing to film the demo through it');
    }
    await page.waitForTimeout(700);

    for (let i = 0; i < steps.length; i++) {
      if (i > 0) await page.evaluate((next) => go(next), i);
      const readMs = baseHold + steps[i].caption.length * 38;
      await page.waitForTimeout(SETTLE + Math.min(readMs, 7000));
      logger.log(`  ${i + 1}/${steps.length}  ${steps[i].caption.slice(0, 60)}`);
    }
    await page.waitForTimeout(1200);

    const video = page.video();
    await context.close();
    context = null;
    if (!video) throw new Error('no video was produced');
    await video.saveAs(outFile);

    await browser.close();
    browser = null;
    if (!fs.existsSync(outFile)) throw new Error('no video was produced');

    const bytes = fs.statSync(outFile).size;
    logger.log(`\nvideo -> ${outFile}  (${(bytes / 1048576).toFixed(1)} MB)`);
    return { outFile, bytes, steps: steps.length };
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(artifactDir, { recursive: true, force: true });
  }
}

function parseArgs(args) {
  const parsed = { src: null, outFile: null, size: '1600x1000', hold: 2200 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out' || arg === '--size' || arg === '--hold') {
      if (args[i + 1] == null) throw new Error(`${arg} requires a value`);
      const value = args[++i];
      if (arg === '--out') parsed.outFile = value;
      else if (arg === '--size') parsed.size = value;
      else parsed.hold = Number(value);
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else if (parsed.src) {
      throw new Error(`unexpected second demo path: ${arg}`);
    } else {
      parsed.src = arg;
    }
  }
  return parsed;
}

async function cli(args = process.argv.slice(2)) {
  const { src, outFile, size, hold } = parseArgs(args);
  if (!src) {
    console.error('usage: node video.js <demo.html> [--out FILE.webm] [--size WxH] [--hold MS]');
    process.exitCode = 1;
    return;
  }
  await renderVideo(src, { outFile, size, hold });
}

if (require.main === module) {
  cli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { renderVideo, parseSize };
