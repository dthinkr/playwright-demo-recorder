# Contributing

Bug reports and focused pull requests are welcome. Use synthetic pages and test
accounts in fixtures. Never commit a real trace, generated demo, session file,
or recording from a private application.

## Local setup

Playwright Demo Recorder requires Node.js 20 or newer.

```bash
npm install
npx playwright install chromium
npm test
```

Build the bundled sample after the tests pass:

```bash
node cli.js sample --out out/sample.html
```

## Pull requests

- Add a failing regression test before fixing a behavior bug.
- Keep changes scoped to one problem.
- Update the README or CLI help when behavior changes.
- Run `npm test` and `npm pack --dry-run` before requesting review.
- Keep generated artifacts, internal URLs, and account data out of commits.

For a new capture route or public API change, open an issue first so the
interface can be discussed before implementation.
