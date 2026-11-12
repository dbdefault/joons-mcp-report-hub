# Using Report Hub in CI

Report Hub is designed for CI: it reads only JSON files, writes only its own output files,
makes no network request, and returns exit codes that map directly onto pipeline decisions.

## Recipe

1. Run the JOONS products that apply to your project and keep their JSON reports as build
   artifacts (one example command each):

   ```bash
   joons-mcp-probe stdio --format json --json-out reports/probe.json -- node server.js
   joons-mcp-diff compare before.json after.json --format json --json-out reports/diff.json
   joons-mcp-policy-gate check snapshot.json --policy policy.json --format json --json-out reports/policy.json
   joons-mcp-contract-test run suite.json --snapshot snapshot.json --fixtures fixtures.json --format json --json-out reports/contract.json
   joons-mcp-mock-server start --snapshot snapshot.json --report reports/mock.json
   ```

2. Validate the inputs cheaply (fast fail; exit 0 = all usable, duplicates and ignored
   snapshots allowed):

   ```bash
   joons-mcp-report-hub validate reports/
   ```

3. Build the dashboard and badges, and/or gate the pipeline on the overall verdict:

   ```bash
   joons-mcp-report-hub build reports/ --out dashboard --stable
   ```

4. Upload `dashboard/` (which contains `index.html`, `summary.json`, `summary.md` and
   `badges/*.svg`) as a workflow artifact.

## Deciding pass/fail

The exit code already encodes the verdict (see the README's exit-code table):

- Default: FAIL -> 1; WARN and NO_DATA -> 0. Use this when warnings should not break the
  build.
- `--fail-on warning`: WARN also breaks the build (exit 1).
- `--fail-on none`: never break the build on the verdict (still exit 2 when no report was
  accepted at all, and 3/4 for usage/output errors).
- `--strict`: additionally break (exit 2) when any input file was rejected, unsupported,
  duplicated-with-error, invalid JSON or exceeded limits. Use this when every file in the
  reports directory must be a valid report.
- `validate` never fails on duplicates or ignored snapshots; it fails (exit 2) only when an
  input is unusable.

## Reproducible artifacts

Use `--stable` for artifacts you want to diff or cache: `generatedAt` becomes null and all
outputs (JSON, Markdown, terminal, HTML, SVG) are byte-identical across runs, independent
of input order and platform line endings.

## GitHub Actions example

```yaml
name: MCP reports
on: [push, pull_request]

permissions:
  contents: read

jobs:
  reports:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # 1. Produce the reports with the other JOONS products, e.g.:
      #    - run: joons-mcp-probe stdio --format json --json-out reports/probe.json -- node server.js
      #    - run: joons-mcp-diff compare before.json after.json --format json --json-out reports/diff.json

      - name: Validate reports
        run: node bin/joons-mcp-report-hub.js validate reports/

      - name: Build dashboard and badges
        run: node bin/joons-mcp-report-hub.js build reports/ --out dashboard-out --stable

      - name: Upload dashboard and badges
        uses: actions/upload-artifact@v4
        with:
          name: mcp-report-hub
          path: dashboard-out

      - name: Gate on overall verdict
        run: node bin/joons-mcp-report-hub.js summary reports/ --fail-on warning --strict
```

Notes:

- No `npm ci` / cache step is needed -- Report Hub has zero dependencies.
- The badge SVGs in `dashboard-out/badges/` are plain files; reference them from your
  README by committing them or by uploading them to your asset hosting of choice. They are
  static and self-contained, so they render identically anywhere.
- Never point `--out` at a directory that contains your input reports: Report Hub refuses
  to write into a directory that contains an input file (exit 4), so outputs can never
  overwrite inputs.
