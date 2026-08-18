#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const pkg = require('./package.json');

const HELP = `Playwright Demo Recorder
An agentic recorder for portable, interactive product demos.

Usage:
  playwright-demo sample [--out demo.html]
  playwright-demo record <flow.js> [--headed] [--out base] [--no-video] [--raw-video]
  playwright-demo attach start|auto|snap|finish|status [options]
  playwright-demo trace <trace.zip> [--out base] [--title text]
  playwright-demo rebuild <steps.json> [--accent hex] [--title text]
  playwright-demo video <demo.html> [--out file.webm] [--size WxH]

Start here:
  sample   Build a three-step demo without launching a browser.

Capture routes:
  record   Drive a fresh Playwright browser with a reusable flow file.
  attach   Tap an existing @playwright/cli session (optional prerequisite).
  trace    Convert an existing Playwright trace recorded with snapshots.

Post-processing:
  rebuild  Restyle captured steps without recording again.
  video    Render a polished video from an interactive demo.

Run "playwright-demo <command> --help" for that command's arguments.
`;

const scripts = {
  sample: 'sample.js',
  record: 'record.js',
  attach: 'ctl.js',
  trace: 'from-trace.js',
  rebuild: 'rebuild.js',
  video: 'video.js',
};

const commandHelp = {
  sample: `Usage: playwright-demo sample [options]

Options:
  --out <file.html>  Output path (default: ./playwright-demo.html).
  --title <text>     Player title.
  --accent <hex>     Player accent colour.
`,
  record: `Usage: playwright-demo record <flow.js> [options]

Options:
  --headed       Show the browser while the flow runs.
  --out <base>   Output basename (default: out/<flow-name>).
  --no-video     Skip the polished video render.
  --raw-video    Also keep the unpolished original browser recording.
`,
  attach: `Usage: playwright-demo attach start|auto|snap|finish|status [options]

Requires the optional @playwright/cli package and a live named session.
Common options: --session <name> --out <base> --title <text> --accent <hex>
Manual snap options: --say <caption> [--at <selector>]
`,
  trace: `Usage: playwright-demo trace <trace.zip> [options]

Options:
  --out <base>   Output basename (default: <trace>-from-trace).
  --title <text> Override the trace title.
  --accent <hex> Player accent colour.
`,
  rebuild: `Usage: playwright-demo rebuild <steps.json> [options]

Options:
  --out <file.html>  Output path (default: beside the steps JSON).
  --accent <hex> Player accent colour.
  --title <text> Override the captured title.
`,
  video: `Usage: playwright-demo video <demo.html> [options]

Options:
  --out <file.webm>  Output path (default: beside the HTML).
  --size <WxH>       Video size (default: 1600x1000).
  --hold <ms>        Base reading time per step.
`,
};

function commandExists(command) {
  const probe = spawnSync(command, ['--help'], {
    stdio: 'ignore',
    timeout: 5000,
  });
  return !(probe.error && probe.error.code === 'ENOENT');
}

function fail(message) {
  process.stderr.write(`[playwright-demo] ${message}\n`);
  process.exitCode = 1;
}

const args = process.argv.slice(2);
const command = args.shift();

if (!command || command === '--help' || command === '-h') {
  process.stdout.write(HELP);
} else if (command === 'help') {
  process.stdout.write(commandHelp[args[0]] || HELP);
} else if (command === '--version' || command === '-v' || command === 'version') {
  process.stdout.write(pkg.version + '\n');
} else if (!scripts[command]) {
  fail(`unknown command "${command}". Run "playwright-demo --help".`);
} else if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(commandHelp[command]);
} else if (command === 'attach' && !commandExists('playwright-cli')) {
  fail('playwright-cli is required for attach mode. Install it with '
    + '"npm install --save-dev @playwright/cli", then open or attach a session.');
} else if (command === 'trace' && !commandExists('unzip')) {
  fail('the "unzip" command is required for trace conversion. Install Info-ZIP '
    + 'or run this route in macOS, Linux, or WSL.');
} else {
  const script = path.join(__dirname, scripts[command]);
  const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' });
  child.on('error', (error) => fail(`could not start ${command}: ${error.message}`));
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}
