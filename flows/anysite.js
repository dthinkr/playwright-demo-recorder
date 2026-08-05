/**
 * Fidelity probe: capture a few structurally different public pages in one run
 * so the failure modes (cross-origin CSS, remote images, webfonts, canvas)
 * show up side by side instead of being guessed at.
 */
const SITES = [
  ['https://news.ycombinator.com/', 'Minimal: same-origin CSS, no webfonts'],
  ['https://en.wikipedia.org/wiki/Central_bank', 'Content-heavy: many images, complex CSS'],
  ['https://github.com/rrweb-io/rrweb', 'App-like UI: cross-origin assets, SVG icons, webfonts'],
];

module.exports = {
  title: 'Capture fidelity across site types',
  viewport: { width: 1440, height: 900 },

  async run(rec, page) {
    for (const [url, note] of SITES) {
      await page.goto(url, { waitUntil: 'load', timeout: 90000 });
      await page.waitForTimeout(2500);
      await rec.note(note + ' — ' + new URL(url).host);
    }
  },
};
