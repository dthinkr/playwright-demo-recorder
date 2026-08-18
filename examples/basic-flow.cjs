const baseUrl = process.env.DEMO_BASE_URL || 'https://example.com';

module.exports = {
  title: 'Example walkthrough',
  viewport: { width: 1280, height: 800 },

  async run(rec, page) {
    await rec.goto(baseUrl, 'Open the product page.');
    await rec.click('a', 'Follow the highlighted link.');
    await page.waitForLoadState('domcontentloaded');
    await rec.note('The destination is ready.');
  },
};
