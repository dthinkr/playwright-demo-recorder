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

**Auto** — one command, then just browse:

```bash
node ctl.js auto --session view --out out/mydemo --title "..."   # arm + watch
# ... the agent browses and clicks as it normally would ...
node ctl.js finish
```

A click listener captures each in-page interaction with its hotspot, and a
watcher captures each page you land on. The watcher also re-arms after every
navigation, since a page load takes the injected listener with it.

*Caveat:* for a click that navigates, the pre-click frame is lost — the page is
torn down before any poll can drain it, so you get the page you landed on
rather than the click that got you there. In-page clicks (dialogs, tabs,
filters) keep their hotspot.

**Manual** — when you want to choose the steps and write the captions:

```bash
node ctl.js start --session view --out out/mydemo --title "..."
node ctl.js snap --say "Click Issues" --at "a[href$='/issues']"
node ctl.js snap --say "The list loads here"
node ctl.js finish
```

Snapshots come back over the CDP eval channel, gzipped and chunked in the page.
A local HTTP collector was the obvious design and does not survive contact with
reality: strict sites set a `connect-src` CSP that blocks the page from posting
to localhost.

### 3. From a trace — nothing to instrument

Playwright already records everything a walkthrough needs, so a trace can be
turned into a demo after the fact — including traces from CI that finished
weeks ago.

```bash
node from-trace.js out/run-trace.zip --title "..."
```

| Needed | Where it already is |
|---|---|
| DOM per step | `frame-snapshot.html` — one taken *before* every action, which is exactly the capture-then-act semantics the other modes hand-roll |
| Hotspot | `input.point` — the real click coordinates |
| Caption | the action's method + selector |
| Viewport, URL | on the snapshot |

No injection, no CSP workaround, no chunked transport, no re-arming after
navigation: every one of those exists only because the other modes cannot see
inside the browser.

**Caveats.** The trace snapshot format is Playwright's own and undocumented —
the decoder here follows their trace-viewer service worker, so it can break on
a version bump. Steps come from *actions* only, so there are no "look at the
result" beats, and captions fall back to a bare verb when the selector carries
no human-readable text. Requires `tracing.start({ snapshots: true })`.

## Also

```bash
node video.js out/convo.html              # video from any built demo
node rebuild.js out/convo-steps.json --accent '#0f766e'   # restyle, no re-record
```

## Built on

Deliberately thin. The parts that are solved problems are not re-solved here:

| | |
|---|---|
| DOM serialize / rebuild | [`rrweb-snapshot`](https://github.com/rrweb-io/rrweb) |
| Callout anchoring, flip, collision | [`@floating-ui/dom`](https://github.com/floating-ui/floating-ui) |
| Browser driving, video capture | [Playwright](https://playwright.dev) |

What is actually ours: the step model (discrete snapshots + hotspots), the
attach transport, and the pipeline.

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
npm test                    # no browser needed
```

Tests cover the parts that fail silently: node-reference addressing in the
trace decoder (a wrong reference yields valid HTML of the wrong page), the
gzip round trip, asset pooling, and self-containment — a demo that quietly
depends on the network looks perfect on the machine that built it.

Playback needs a current browser (Chrome 80+, Safari 16.4+, Firefox 113+) for
`DecompressionStream`.
