/**
 * DemoRecorder — drives a Playwright page and captures a DOM snapshot plus a
 * hotspot rect at each step, which the player turns into a walkthrough.
 *
 * Snapshot semantics: a step is captured BEFORE its action, with the hotspot on
 * the element about to be used. The viewer clicks that hotspot and lands on the
 * next snapshot — the state after the action. Same model Supademo uses.
 *
 * The recorder no longer paints a cursor into the page. Video is filmed from
 * the finished player (see video.js), which animates its own cursor, callouts
 * and transitions — so a second cursor drawn during capture was dead weight
 * that only showed up in a raw browsing video nothing consumes.
 */
const fs = require('fs');
const path = require('path');

// Direct path: the package's "exports" map does not expose dist/, so
// require.resolve() on the subpath throws ERR_PACKAGE_PATH_NOT_EXPORTED.
// We need the UMD build as raw text to inject into the page, not to require it.
const SNAPSHOT_LIB = path.join(
  __dirname, '..', 'node_modules', 'rrweb-snapshot', 'dist', 'rrweb-snapshot.umd.min.cjs',
);


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class DemoRecorder {
  /**
   * @param {import('playwright').Page} page
   * @param {{typeDelay?: number, cursorTravel?: number, settle?: number}} [opts]
   */
  constructor(page, opts = {}) {
    this.page = page;
    this.steps = [];
    this.typeDelay = opts.typeDelay ?? 55;      // ms per character
    this.cursorTravel = opts.cursorTravel ?? 500; // must exceed the CSS transition
    this.settle = opts.settle ?? 350;            // let animations finish before snapshotting
    this._libSource = fs.readFileSync(SNAPSHOT_LIB, 'utf8');
  }

  /** Re-inject on every navigation (a fresh document loses the library). */
  async init() {
    await this.page.addInitScript({ content: this._libSource });
    await this._ensureInjected();
  }

  async _ensureInjected() {
    const ready = await this.page.evaluate(() => !!window.rrwebSnapshot);
    if (ready) return;
    await this.page.addScriptTag({ content: this._libSource }).catch(() => {});
  }

  /**
   * Serialize the current DOM plus the geometry the player needs to place a
   * hotspot: viewport size (the iframe is sized to match) and scroll offset.
   *
   * Dev-only chrome (Nuxt DevTools, Vite overlays, our own cursor) is stripped
   * first — it is an artefact of recording against a dev server and has no
   * business in a demo someone else opens.
   */
  async _snapshot(caption, hotspot) {
    await this._ensureInjected();
    await sleep(this.settle);
    const data = await this.page.evaluate(() => {
      const NOISE = [
        '#nuxt-devtools-container', '.nuxt-devtools-panel', '[data-v-inspector-container]',
        'vite-plugin-checker-error-overlay', 'vite-error-overlay',
        '#nuxt-devtools-anchor', '.nuxt-devtools-anchor',
      ];
      const hidden = [];
      NOISE.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          hidden.push([el, el.style.display]);
          el.style.display = 'none';
        });
      });
      const snap = window.rrwebSnapshot.snapshot(document, {
        inlineStylesheet: true,
        inlineImages: true,
        recordCanvas: true,
      });
      hidden.forEach(([el, prev]) => { el.style.display = prev; });
      return {
        snapshot: snap,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scroll: { x: window.scrollX, y: window.scrollY },
        url: location.href,
      };
    });
    this.steps.push({ ...data, caption, hotspot: hotspot ?? null });
    return this.steps.length;
  }

  /** Hotspot rect in viewport coordinates — matches how the player positions it. */
  async _rectOf(selector) {
    const box = await this.page.locator(selector).first().boundingBox();
    if (!box) return null;
    const scroll = await this.page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    return {
      x: box.x - scroll.x,
      y: box.y - scroll.y,
      width: box.width,
      height: box.height,
    };
  }

  /** Move the real pointer over the target, so hover styles are captured. */
  async _cursorTo(selector) {
    const rect = await this._rectOf(selector);
    if (!rect) return null;
    await this.page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await sleep(this.cursorTravel);
    return rect;
  }

  async goto(url, caption) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this._ensureInjected();
    if (caption) await this._snapshot(caption, null);
  }

  /** Capture the current state with a hotspot, then click. */
  async click(selector, caption) {
    const rect = await this._cursorTo(selector);
    await this._snapshot(caption, rect);
    await this.page.locator(selector).first().click();
  }

  /** Capture, then type visibly (per-character, so the video shows the input). */
  async type(selector, text, caption) {
    const rect = await this._cursorTo(selector);
    await this._snapshot(caption, rect);
    const field = this.page.locator(selector).first();
    await field.click();
    await field.fill('');
    await field.pressSequentially(text, { delay: this.typeDelay });
  }

  async press(key) {
    await this.page.keyboard.press(key);
  }

  /** Capture the current state with no hotspot — for showing a result. */
  async note(caption) {
    return this._snapshot(caption, null);
  }

  async waitFor(selector, timeout = 60000) {
    await this.page.locator(selector).first().waitFor({ state: 'visible', timeout });
  }

  /** Poll a page-side predicate — for streamed content with no stable selector. */
  async waitUntil(fn, timeout = 90000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await this.page.evaluate(fn)) return true;
      await sleep(1000);
    }
    return false;
  }
}

module.exports = { DemoRecorder, sleep };
