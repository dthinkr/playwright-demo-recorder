# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

Initial public release candidate.

### Added

- Three capture routes: existing Playwright trace, reusable flow, and an
  experimental live `@playwright/cli` session.
- Portable single-file interactive HTML, rebuildable step data, and optional
  polished WebM output.
- Package-installed CLI, CommonJS API, bundled sample, privacy guardrails, and
  clean-install regression coverage.

### Fixed

- Package dependency resolution when npm hoists dependencies.
- Hotspot coordinates on scrolled pages.
- Password value leakage in DOM snapshots.
- Failed or empty flows overwriting the last successful trace.
