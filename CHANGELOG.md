# Changelog

## 0.1.0 -- 2026-11-12 (Preview)

First public release.

- Reads the JSON reports of the five JOONS MCP products and normalizes them into one
  summary (`joons-mcp-report-hub/summary`, schemaVersion 1):
  - probe reports (health: PASS / WARNING / FAIL), including `failure` findings;
  - diff compare results (change risk: none / low / unknown / high) with breaking/unknown/
    non-breaking change aggregation and consistency checks;
  - policy-gate check results (policy compliance: PASS / WARN / FAIL) with fail/warn
    consistency checks;
  - contract-test run reports (test results: PASS / FAIL) with assertion-root aggregation,
    SKIP handling and `testSuccessRate` (`FLOOR(100*passed/(passed+failed))`);
  - mock-server session reports as call **recordings** (RECORDED, info level -- never a
    test result, never green or red);
  - policy/mock/contract validation reports (VALID / VALID_WITH_WARNINGS / INVALID);
  - diff snapshots recognized as `ignored_input` (never an error).
- Safety model: allowlist-by-default output, `--details` (redacted free text) and
  `--show-file-names` opt-ins, fixed-regex redaction (URLs, paths, e-mail, IPs, secrets,
  opaque tokens), strict input limits, prototype-pollution-resistant maps, and output
  directory protection with fixed file names and atomic writes.
- Static, fully offline dashboard (`index.html`) with a Content-Security-Policy meta tag
  (SHA-256 of the single inline style/script), no external resources, filter/expand script
  that is optional for viewing, dark-mode support and a 360 px responsive layout.
- SVG badges for the overall verdict and each product (mock-server badge is always grey and
  shows a call count).
- CLI: `build`, `summary` (terminal/json/markdown), `badge`, `validate`, `--help`,
  `--version`, with the documented exit-code contract (0/1/2/3/4) and `--fail-on`,
  `--strict`, `--duplicates`, `--stable`, `--force`, `--quiet` flags.
- `--stable` mode: byte-identical outputs across runs, input orders and platforms.
- Zero runtime and dev dependencies; Node.js >= 20; Apache-2.0.

**Preview notice:** input and output formats may change before 1.0. The package is not
published on npm; install from GitHub (see the README).
