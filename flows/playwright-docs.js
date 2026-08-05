/**
 * playwright.dev — a walkthrough of someone else's docs site.
 *
 * Picked as a stress test rather than a friendly one: every step below is
 * in-page JS state that has no URL and no server round trip — a command-palette
 * search modal, a package-manager tab group, a colour-mode toggle that rewrites
 * every custom property on the page. A screenshot recorder gets pixels of these;
 * a DOM clone gets the state itself, still styled, still hoverable.
 */
module.exports = {
  title: 'playwright.dev — finding your way around the docs',
  viewport: { width: 1440, height: 900 },
  timeout: 90000,
  options: { typeDelay: 60, settle: 700 },

  async run(rec, page) {
    await page.goto('https://playwright.dev/docs/intro', { waitUntil: 'domcontentloaded' });
    await rec.waitFor('h1', 60000);
    await page.waitForTimeout(2500);

    // ── 1. Command palette: opens a modal that exists only in memory ─────
    await rec.click('button[class*="DocSearch-Button"], button:has-text("Search")',
      'Start with the search button — it opens a command palette, not a page.');
    await page.waitForSelector('.DocSearch-Modal, [class*="DocSearch-Modal"]', { timeout: 30000 });
    await page.waitForTimeout(1200);
    await rec.note('The palette is pure in-page state: no navigation, no URL to point at.');

    // ── 2. Type into it and let the live results come back ──────────────
    await page.locator('.DocSearch-Input').first().pressSequentially('trace viewer', { delay: 70 });
    await page.waitForTimeout(2600);
    await rec.note('Results stream in as you type, captured mid-query with the hits in place.');

    // ── 3. Dismiss and use the sidebar instead ──────────────────────────
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    await rec.click('a.menu__link:has-text("Trace viewer"), aside a:has-text("Trace viewer")',
      'Close it and take the sidebar route to the same page.');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2600);
    await rec.note('Trace Viewer docs. Sidebar, breadcrumbs and the on-page contents all live.');

    // ── 4. Package-manager tabs: sibling state, no navigation ───────────
    const yarnTab = page.locator('li.tabs__item:has-text("yarn")').first();
    if (await yarnTab.count()) {
      await rec.click('li.tabs__item:has-text("yarn")',
        'Code samples are tabbed per package manager.');
      await page.waitForTimeout(1400);
      await rec.note('Switching the tab swaps the snippet — the selection is captured as it stood.');
    }

    // ── 5. Colour mode: rewrites the custom properties the whole page uses,
    //       which is the clearest proof the clone carries real CSS.
    //
    // The toggle cycles (system -> light -> dark), so one click lands wherever
    // the visitor's OS happens to point. Click until the DOM actually says dark
    // before captioning it — a caption that claims a state the capture does not
    // show is worse than no caption.
    const THEME = 'button[class*="colorModeToggle"], button[title*="mode"], button[aria-label*="mode"]';
    await rec.click(THEME, 'Now flip the site into dark mode.');
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(900);
      const dark = await page.evaluate(
        () => document.documentElement.getAttribute('data-theme') === 'dark',
      );
      if (dark) break;
      await page.locator(THEME).first().click();
    }
    const isDark = await page.evaluate(
      () => document.documentElement.getAttribute('data-theme') === 'dark',
    );
    await page.waitForTimeout(1500);
    await rec.note(isDark
      ? 'Dark mode, captured. The clone kept the stylesheet, so the theme came with it.'
      : 'Theme switched. The clone carries whatever the stylesheet was doing at capture time.');

    // ── 6. Language switcher, still dark ────────────────────────────────
    const langBtn = page.locator('.navbar__item.dropdown').first();
    if (await langBtn.count()) {
      await rec.click('.navbar__item.dropdown',
        'The docs ship per language — open the switcher.');
      await page.waitForTimeout(1500);
      await rec.note('An open dropdown is state a screenshot would have to catch by luck.');
    }
  },
};
