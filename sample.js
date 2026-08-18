#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { buildPlayer } = require('./lib/build');

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}

function page(body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f6f7fb; color: #171925; }
  .app { width: 1200px; height: 760px; display: grid; grid-template-columns: 220px 1fr; }
  aside { padding: 28px 20px; background: #151724; color: #fff; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 760; }
  .mark { width: 26px; height: 22px; border: 2px solid #a9a2ff; border-radius: 6px; position: relative; }
  .mark::after { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #7567ff; position: absolute; right: -5px; bottom: -5px; box-shadow: 0 0 0 4px #393453; }
  nav { margin-top: 44px; display: grid; gap: 8px; }
  nav span { padding: 10px 12px; color: #969bac; border-radius: 8px; }
  nav .on { color: #fff; background: #26293a; }
  main { padding: 30px 34px; overflow: hidden; }
  header { display: flex; align-items: center; min-height: 44px; }
  h1 { margin: 0; font-size: 28px; letter-spacing: -.03em; }
  .sub { margin-top: 7px; color: #6f7485; }
  .push { flex: 1; }
  button { border: 0; border-radius: 9px; padding: 12px 18px; background: #5948e8; color: #fff; font: 700 14px inherit; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 30px; }
  .card { border: 1px solid #e2e4ed; border-radius: 14px; background: #fff; padding: 20px; box-shadow: 0 5px 20px rgba(23,25,37,.04); }
  .label { color: #777c8e; font-size: 13px; }
  .number { margin-top: 8px; font-size: 30px; font-weight: 760; }
  .panel { margin-top: 22px; border: 1px solid #e2e4ed; border-radius: 14px; background: #fff; padding: 24px; }
  .panel h2 { margin: 0; font-size: 18px; }
  .routes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 22px; }
  .route { min-height: 150px; padding: 18px; border: 1px solid #dfe2ec; border-radius: 12px; }
  .route.on { border: 2px solid #6554ed; background: #f5f3ff; }
  .route b { display: block; margin: 13px 0 8px; }
  .route p { margin: 0; color: #6f7485; font-size: 13px; line-height: 1.5; }
  .route code { color: #5948e8; font: 650 12px ui-monospace, SFMono-Regular, monospace; }
  .actions { display: flex; justify-content: flex-end; margin-top: 24px; }
  .success { display: grid; place-items: center; min-height: 520px; text-align: center; }
  .check { width: 58px; height: 58px; margin: 0 auto 18px; display: grid; place-items: center; border-radius: 50%; background: #e9e6ff; color: #5948e8; font-size: 28px; font-weight: 800; }
  .success h2 { margin: 0; font-size: 27px; }
  .files { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; width: 580px; margin: 28px auto 0; text-align: left; }
  .file { padding: 18px; border: 1px solid #e2e4ed; border-radius: 12px; background: #fff; }
  .file b { display: block; margin-bottom: 6px; }
  .file span { color: #777c8e; font-size: 13px; }
</style>
</head>
<body><div class="app">
  <aside><div class="brand"><span class="mark"></span> Demo Studio</div>
    <nav><span class="on">Captures</span><span>Flows</span><span>Exports</span></nav>
  </aside>
  <main>${body}</main>
</div></body></html>`;
}

const steps = [
  {
    html: page(`<header><div><h1>Product demos</h1><div class="sub">Turn browser work into a story people can follow.</div></div><div class="push"></div><button>New capture</button></header>
      <section class="grid"><div class="card"><div class="label">Ready to share</div><div class="number">12</div></div><div class="card"><div class="label">Reusable flows</div><div class="number">7</div></div><div class="card"><div class="label">Last build</div><div class="number">42s</div></div></section>
      <section class="panel"><h2>Recent demos</h2><div class="routes"><div class="route"><code>onboarding.html</code><b>Workspace onboarding</b><p>5 guided steps · rebuilt today</p></div><div class="route"><code>release.webm</code><b>Release overview</b><p>Polished video · 01:12</p></div><div class="route"><code>billing.html</code><b>Billing controls</b><p>8 guided steps · local file</p></div></div></section>`),
    caption: 'Start from the browser run your agent already completed.',
    url: 'https://demo.local/captures',
    viewport: { width: 1200, height: 760 },
    scroll: { x: 0, y: 0 },
    hotspot: { x: 1012, y: 30, width: 142, height: 44 },
  },
  {
    html: page(`<header><div><h1>New capture</h1><div class="sub">Choose the browser artifact you already have.</div></div></header>
      <section class="panel"><h2>Capture source</h2><div class="routes">
        <div class="route on"><code>trace.zip</code><b>Existing trace</b><p>Compile a Playwright trace from CI or a local test. The app can stay offline.</p></div>
        <div class="route"><code>flow.cjs</code><b>Reusable flow</b><p>Commit the walkthrough and rebuild it when the product changes.</p></div>
        <div class="route"><code>@playwright/cli</code><b>Live session</b><p>Capture selected moments while an agent drives an attached browser.</p></div>
      </div><div class="actions"><button>Compile demo</button></div></section>`),
    caption: 'Use a trace, a committed flow, or an agent-driven live session.',
    url: 'https://demo.local/captures/new',
    viewport: { width: 1200, height: 760 },
    scroll: { x: 0, y: 0 },
    hotspot: { x: 992, y: 389, width: 162, height: 44 },
  },
  {
    html: page(`<header><div><h1>Capture ready</h1><div class="sub">The viewer only needs a current browser.</div></div></header>
      <section class="success"><div><div class="check">✓</div><h2>Workspace onboarding</h2><div class="sub">3 guided steps compiled from the same browser run.</div>
      <div class="files"><div class="file"><b>demo.html</b><span>Portable interactive walkthrough</span></div><div class="file"><b>demo.webm</b><span>Optional polished video</span></div></div></div></section>`),
    caption: 'Share one HTML file, or render video from the same captured steps.',
    url: 'file:///workspace/demo.html',
    viewport: { width: 1200, height: 760 },
    scroll: { x: 0, y: 0 },
    hotspot: null,
  },
];

try {
  const args = process.argv.slice(2);
  const output = path.resolve(option(args, '--out', 'playwright-demo.html'));
  const accent = option(args, '--accent', '#4f46e5');
  if (!/^#[0-9a-f]{6}$/i.test(accent)) throw new Error('--accent must be a six-digit hex colour');
  const result = buildPlayer({
    title: option(args, '--title', 'Playwright Demo Recorder'),
    steps,
    outFile: output,
    accent,
  });
  process.stdout.write(`Created ${result.outFile} (${result.steps} steps)\n`);
} catch (error) {
  process.stderr.write(`[playwright-demo] ${error.message}\n`);
  process.exitCode = 1;
}
