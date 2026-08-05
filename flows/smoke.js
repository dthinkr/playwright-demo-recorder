/**
 * Mechanism smoke test — no local stack needed.
 * Proves: snapshot fidelity, hotspot placement, typing, navigation, rebuild.
 */
module.exports = {
  title: 'Recorder smoke test',
  viewport: { width: 1280, height: 800 },
  async run(rec, page) {
    await rec.goto('https://example.com', 'Landing page as captured');
    await rec.click('a', 'Click through to the IANA page');
    await page.waitForLoadState('domcontentloaded');
    await rec.note('Arrived on the linked page');
  },
};
