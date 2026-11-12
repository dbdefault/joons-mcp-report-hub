# Example reports

Ten real report files (byte-exact copies of `tests/fixtures/real/`) -- a passing case and a
failing/warning/breaking case for each of the five JOONS products:

| File | Product | Meaning |
| --- | --- | --- |
| `probe-pass.json` | probe | Server health: PASS |
| `probe-fail.json` | probe | Server health: FAIL (handshake failure) |
| `diff-no-changes.json` | diff | Change risk: none (no changes) |
| `diff-breaking.json` | diff | Change risk: high (BREAKING changes) |
| `policy-gate-pass.json` | policy-gate | Policy compliance: PASS |
| `policy-gate-fail.json` | policy-gate | Policy compliance: FAIL |
| `mock-session.json` | mock-server | Mock session **recording** (5 calls) -- never a pass/fail verdict |
| `mock-validation-invalid.json` | mock-server | Input validation: INVALID |
| `contract-pass.json` | contract-runner | Test results: PASS (2 passed) |
| `contract-fail.json` | contract-runner | Test results: FAIL (3 failed, 1 skipped) |

## Exact commands

Run from the repository root (or replace `node bin/joons-mcp-report-hub.js` with
`joons-mcp-report-hub` if installed globally):

```bash
# 1. Check every input is usable (exit 0)
node bin/joons-mcp-report-hub.js validate examples/reports

# 2. Terminal summary (exit 1: the set intentionally contains failing reports)
node bin/joons-mcp-report-hub.js summary examples/reports

# 3. JSON summary on stdout
node bin/joons-mcp-report-hub.js summary examples/reports --format json

# 4. Markdown summary
node bin/joons-mcp-report-hub.js summary examples/reports --format markdown

# 5. Full dashboard + summary.json/md + badges (exit 1)
node bin/joons-mcp-report-hub.js build examples/reports --out dashboard-out --stable

# 6. Badges only
node bin/joons-mcp-report-hub.js badge examples/reports --out badges-out
```

## Expected results

- Overall verdict: **FAIL** -- `policy-gate-fail.json`, `probe-fail.json`,
  `diff-breaking.json` (high risk), `contract-fail.json` and
  `mock-validation-invalid.json` (INVALID) are all failure-level.
- Totals: 10 files, 10 reports (no duplicates, no ignored inputs, no rejections).
- Test success rate: 2 passed, 3 failed -> `FLOOR(200/5)` = **40%**.
- Badges: `overall.svg` = FAIL (red), `probe.svg` = FAIL, `diff.svg` = BREAKING,
  `policy-gate.svg` = FAIL, `contract-runner.svg` = `40% PASS` (red), `mock-server.svg` =
  `5 calls` (grey -- recordings are never green or red).
- `dashboard-out/` contains `index.html`, `summary.json`, `summary.md`, `badges/*.svg` and
  the `.joons-report-hub-output` marker; the HTML page is fully offline (no external
  references) and works with scripting disabled.

`--stable` makes `summary.json` etc. byte-identical across runs (`generatedAt` is null),
so you can diff or cache the output directory.
