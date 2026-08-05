# demo-recorder

Turn a browser session into an **interactive product demo** — a single HTML file
that clones the real DOM, not a slideshow of screenshots.

Agent-driven: a script (or an agent already browsing) does the clicking, and the
demo falls out of it. That is the part existing tools don't do — Supademo,
Arcade, Navattic and Storylane all need a human clicking a Chrome extension, and
every open-source Playwright demo tool outputs video.

## What comes out

| Artifact | What it is |
|---|---|
| `demo.html` | Self-contained interactive walkthrough. Real DOM, real CSS, hover states intact. Click hotspots to advance. No server, no account, no network. |
| `demo.webm` | Video of the finished demo — gliding cursor, callouts, dissolves — filmed from the player, not from the original browsing. |
| `demo-steps.json` | Raw capture, so the player can be restyled without re-recording. |

Steps ship gzipped inside the HTML, so a multi-MB capture lands around 1 MB.

## Two ways to capture

### 1. Flow file — reproducible

Write the path once; re-run it whenever the product changes. This is the reason
to build rather than buy: a hosted demo tool needs a human to re-record after
every UI change, this needs one command.

```bash
node record.js flows/convo.js            # -> out/convo.html + .webm + trace
node record.js flows/convo.js --headed   # watch it drive
```

A flow exports `{ title, viewport?, run(rec, page) }`:

```js
module.exports = {
  title: 'Ask a follow-up on your search',
  viewport: { width: 1440, height: 900 },
  async run(rec, page) {
    await rec.goto(APP + '/search', null);
    await rec.type('input[placeholder*="Search"]', 'NLP complaints triage',
                   'Start with an ordinary search.');   // captures, then types
    await rec.press('Enter');
    await rec.note('The AI Overview summarises the results.');  // captures, no hotspot
  },
};
```

`rec.click()` / `rec.type()` capture the state **before** the action with a
hotspot on the target — the viewer clicks that hotspot and lands on the result.
Same model Supademo uses. `rec.note()` is a "look at this" beat.

### 2. Attach — record a session someone else is driving

Taps a live `playwright-cli` session instead of owning the browser. Real clicks,
existing login state, no separate run.

```bash
node ctl.js start --session view --out out/mydemo --title "..."
# ... browse and click normally ...
node ctl.js snap --say "Click Issues" --at "a[href$='/issues']"
node ctl.js snap --say "The list loads here"
node ctl.js finish
```

Snapshots come back over the CDP eval channel, gzipped and chunked in the page.
A local HTTP collector was the obvious design and does not survive contact with
reality: strict sites set a `connect-src` CSP that blocks the page from posting
to localhost.

## Also

```bash
node video.js out/convo.html              # video from any built demo
node rebuild.js out/convo-steps.json --accent '#0f766e'   # restyle, no re-record
```

## How it works

`rrweb-snapshot` serializes the live DOM — inlining stylesheets, images, fonts
and input values — and rebuilds it into a sandboxed iframe at playback. Scripts
are neutered at capture time and the iframe gets no `allow-scripts`, so the
clone is inert: CSS, hover states, fonts and layout survive; nothing executes.

That inertness is why demos are stepwise rather than a live sandbox — each
JS-driven state is captured as its own step and stitched with hotspots.
Supademo works the same way. Cloning the running app instead is a different
(much larger) class of product.

## Known limits

- **JS does not run in the clone.** CSS-driven motion survives; a dropdown that
  needs JS does not open. Capture each state as a step.
- **Size scales with page complexity.** ~1 MB/step for a typical app page, 4–5 MB
  for something like a GitHub repo view (before compression).
- **Canvas/WebGL** is unreliable, **cross-origin iframes** cannot be serialized.
- Sites with bot protection may refuse Playwright entirely.

## Setup

```bash
npm install
npx playwright install chromium
```

Playback needs a current browser (Chrome 80+, Safari 16.4+, Firefox 113+) for
`DecompressionStream`.
