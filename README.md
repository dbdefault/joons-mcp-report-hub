# JOONS MCP Report Hub

Turn MCP diagnostics and test results into unified reports, dashboards, and CI badges.

![Status: Preview](https://img.shields.io/badge/status-Preview-orange)
![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)
![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D%2020-green)
![CI](https://github.com/dbdefault/joons-mcp-report-hub/actions/workflows/ci.yml/badge.svg)

JOONS MCP Report Hub reads the JSON reports produced by the
[JOONS ecosystem](https://github.com/dbdefault/joons-ecosystem) MCP diagnostics tools (Probe,
Diff, Policy Gate, Mock Server and Contract Test Runner) and turns them into one normalized
summary, a self-contained offline HTML dashboard, and SVG badges for README files and CI.

It needs none of the other products installed, **never connects to an MCP server, never runs
a tool or any other program, and makes no network request.** It only reads JSON files you
point it at and writes its own output files.

Part of the [JOONS ecosystem](https://github.com/dbdefault/joons-ecosystem).

## Why

Each JOONS product answers a different question and writes a different JSON dialect:

- **Probe** -- the health of one real MCP server at one moment (PASS / WARNING / FAIL).
- **Diff** -- the change risk between two snapshots (BREAKING / NON_BREAKING / UNKNOWN).
- **Policy Gate** -- the policy compliance of one recorded snapshot (PASS / WARN / FAIL).
- **Mock Server** -- a mock server; its `--report` is a *call recording*, not a test result.
- **Contract Test Runner** -- behavioural test results against the mock (PASS / FAIL per test).

Report Hub gives you one place to see all of them: a single overall verdict, per-product
status, a test success rate, a dashboard, and badges -- without any of the five products'
semantics being conflated, and without report content leaking into your dashboard.

## Safety first

Report content is treated as **untrusted input**:

- **Default output is an allowlist.** Only Report Hub's own fixed vocabulary, enumerated
  tokens from known sets (unknown tokens become `unknown`), validated numbers, product
  version strings, validated timestamps, and anonymous source labels (`report-<n>` + a
  SHA-256 prefix) can reach any output. Tool names, server names, messages, labels, paths,
  URLs, command lines, arguments, stderr and error text are **dropped** in default mode.
- **`--details`** (explicit opt-in) additionally allows short free text per finding, after
  control-character stripping, fixed-regex redaction (URLs, paths, e-mail, IPs, bearer/JWT
  and other secrets) and truncation to 200 characters. The output is then marked
  "details: may contain internal names".
- **`--show-file-names`** (explicit opt-in) shows the input file base name, after the same
  sanitising; by default only `report-<n>` + hash is shown, never a directory.
- **Redaction** uses a fixed set of regular expressions with bounded quantifiers -- no
  user-controlled input ever becomes a `RegExp`, a command, a path or a URL.
- **No network.** The dashboard references no external resource of any kind (no CDN, fonts,
  images, links, fetch/XHR or forms), carries a Content-Security-Policy that allows nothing
  external, and embeds report data only as escaped text -- never as embedded JSON in a
  script.
- **Prototype pollution safe.** Maps built from report data use `Map` or
  `Object.create(null)`; fields are read with `hasOwn` and plain-object checks only.

See [docs/PRIVACY.md](docs/PRIVACY.md) for the exact field-by-field privacy model and
[SECURITY.md](SECURITY.md) for the threat model.

## Quick start

Requires Node.js >= 20. Zero runtime dependencies -- nothing needs installing beyond the
package itself.

```bash
npm install -g github:dbdefault/joons-mcp-report-hub#v0.1.0
```

Produce reports with the other JOONS products (one example command each; Report Hub only
reads the files these commands write):

```bash
# Probe: health of one real MCP server
joons-mcp-probe stdio --format json --json-out probe.json -- node server.js

# Diff: change risk between two snapshots
joons-mcp-diff compare before.json after.json --format json --json-out diff.json

# Policy Gate: policy compliance of one snapshot
joons-mcp-policy-gate check snapshot.json --policy policy.json --format json --json-out policy.json

# Contract Test Runner: behavioural tests against the mock
joons-mcp-contract-test run suite.json --snapshot snapshot.json --fixtures fixtures.json --format json --json-out contract.json

# Mock Server: record a mock session (--report is a call recording, not a test result)
joons-mcp-mock-server start --snapshot snapshot.json --report mock.json
```

Then turn them into a dashboard, a summary, badges and a validation pass:

```bash
# Self-contained offline dashboard + summary.json/md + badges/
joons-mcp-report-hub build probe.json diff.json policy.json contract.json mock.json --out dashboard

# Summary on the terminal (also: --format json | markdown, --out FILE)
joons-mcp-report-hub summary probe.json diff.json

# SVG badges only
joons-mcp-report-hub badge . --out badges

# Are these inputs usable? (exit 0 = all usable; ignored snapshots and duplicates allowed)
joons-mcp-report-hub validate reports/
```

A ready-made input set lives in [examples/reports](examples/reports); see
[examples/README.md](examples/README.md) for the exact commands and expected results.

## Supported report types

All formats are `schemaVersion: 1` today.

| Input | Product | Detection | Normalized type |
| --- | --- | --- | --- |
| Probe report | probe | no `format` key; `schemaVersion === 1`, `tool.name === "joons-mcp-probe"`, has `status` and `target` | `probe_report` |
| `joons-mcp-diff/result` | diff | `format` string | `diff_result` |
| `joons-mcp-policy-gate/result` | policy-gate | `format` string | `policy_check` |
| `joons-mcp-mock-server/report` | mock-server | `format` string | `mock_session` -- a call **recording**; it has no verdict and is never a test result |
| `joons-mcp-contract-test/report` | contract-runner | `format` string | `contract_run` |
| `joons-mcp-policy-gate/policy-validation`, `joons-mcp-mock-server/validation`, `joons-mcp-contract-test/validation` | policy-gate / mock-server / contract-runner | `format` string | `validation` |

Recognized but **not** reports: `joons-mcp-diff/snapshot` files are listed as `ignored_input`
and are never an error -- they are inputs *for* the other products, not results.
Anything else is a problem (`unknown_format`); a known format with `schemaVersion !== 1` is
`unsupported_version`. See [docs/REPORTS.md](docs/REPORTS.md) for the full per-type mapping
of what is read, how it maps to status/level, and what is dropped.

Guard and Allocator reports are **not supported** in 0.1.0 (they have no stable report
format).

## Status semantics -- six kinds, never conflated

Every status travels with its **kind**; renderers always show the kind label next to the
value:

| Kind | Label | Products | Values |
| --- | --- | --- | --- |
| `health` | Server health | probe | `PASS` / `WARNING` / `FAIL` |
| `change_risk` | Change risk | diff | `none` / `low` / `unknown` / `high` (from `summary.risk`) |
| `policy` | Policy compliance | policy-gate | `PASS` / `WARN` / `FAIL` |
| `tests` | Test results | contract-runner | `PASS` / `FAIL` |
| `recording` | Mock recording | mock-server | `RECORDED` -- info level only, never green or red |
| `validation` | Input validation | policy-gate, mock-server, contract-runner | `VALID` / `VALID_WITH_WARNINGS` / `INVALID` |

Levels are `ok` > `warning` > `failure`, plus `info` (mock recordings) and `none` (no
reports). A mock recording never turns anything green or red, and a diff `UNKNOWN` risk is a
*warning*, not a failure -- these semantics are never mixed.

## The overall verdict

`PASS` / `WARN` / `FAIL` / `NO_DATA`, computed exactly as follows:

1. Any report with level `failure` -> **FAIL** (`failing_report`).
2. Else, any report with level `warning`, or any rejected/unsupported input file
   (any problem other than `duplicate`/`ignored_input`) -> **WARN** (`warning_report`
   and/or `input_problem`). A rejected input can never produce PASS.
3. Else, no report with level `ok`/`warning`/`failure` at all (only mock recordings, or
   nothing accepted) -> **NO_DATA** (`no_verdict_reports`).
4. Else **PASS**.

Info-level mock recordings never affect the verdict.

## Dashboard

`build` writes one static `index.html`:

- header with the overall badge, generation time (or "not recorded" under `--stable`) and a
  mode note (including the details warning when `--details` was used);
- an overall card with the verdict reasons; product cards for **all five** products (with a
  "no reports" state); failing items first (failures, then warnings);
- the test success rate; a per-report table (id, product, status kind + value, timestamp or
  "not available", duration); per-report `<details>` sections with counts and findings;
- the problems list ("unsupported or rejected inputs") and a "missing information" list;
- a link-free footer explaining how verdicts are aggregated.

The page is fully offline (no external resource of any kind), ships a
`Content-Security-Policy` meta tag with real SHA-256 hashes of its single inline `<style>`
and single inline `<script>`, embeds report data only as escaped text (never as JSON inside
a script), works with scripting disabled, is responsive down to 360 px, supports
`prefers-color-scheme: dark`, uses semantic landmarks and never signals by colour alone.

## Badges

`badge` (or `build`) writes SVG badges with fixed templates; all dynamic text is
fixed-vocabulary or numbers, escaped, with a `role="img"` + `<title>` and no scripts,
external references or event handlers.

| Badge file | Label | Value | Colour |
| --- | --- | --- | --- |
| `badges/overall.svg` | `MCP reports` | overall status: `PASS` / `WARN` / `FAIL` / `NO DATA` | by overall level |
| `badges/probe.svg` | `MCP Probe` | worst status: `PASS` / `WARNING` / `FAIL` | by worst level |
| `badges/diff.svg` | `MCP Diff` | worst risk: `BREAKING` / `UNKNOWN` / `NON-BREAKING` / `NO CHANGES` | by worst risk level |
| `badges/policy-gate.svg` | `Policy Gate` | `PASS` / `WARN` / `FAIL` | by worst level |
| `badges/mock-server.svg` | `Mock Server` | `<calls> calls` | always info grey -- never green/red |
| `badges/contract-runner.svg` | `Contract Tests` | `<percent>% PASS`, or `NO TESTS` | red if any run failed, else green |

A badge's value is always derivable from `summary.json` and agrees with it.

GitHub Actions example -- build the dashboard and upload it together with the badges as a
workflow artifact:

```yaml
- name: Build MCP report dashboard
  run: node path/to/joons-mcp-report-hub/bin/joons-mcp-report-hub.js build reports/ --out dashboard-out --stable

- name: Upload dashboard and badges
  uses: actions/upload-artifact@v4
  with:
    name: mcp-report-hub
    path: dashboard-out
```

(`--stable` makes the output byte-identical across runs, so the artifact is reproducible.)

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | overall PASS, or NO_DATA with at least one accepted report, or any result with `--fail-on none` |
| `1` | overall FAIL, or WARN with `--fail-on warning` |
| `2` | no accepted report at all; or any input problem with `--strict`; or invalid input arguments |
| `3` | usage error (unknown command/option, missing value, ...) |
| `4` | output error (the output directory was refused, or writing failed) |

`validate`: `0` when all inputs are usable (duplicates and ignored snapshots are allowed),
`2` otherwise, `3` on usage errors. NO_DATA and WARN do not fail by default.

## Limits

Enforced before parsing where possible: 8 MiB per file (stat first), 64 MiB total, 500 files,
JSON depth 64, 500,000 nodes, any string or key at most 100,000 code units (longer ->
`limit_exceeded`), at most 500 report entries retained. Invalid UTF-8 is a fatal decode
error; one BOM is stripped; JSON parse errors carry `line:column` only -- never content,
never a path.

## Privacy model

- **Default mode**: nothing from a report reaches the output except the allowlist described
  in [docs/PRIVACY.md](docs/PRIVACY.md) -- fixed vocabulary, known-set tokens, validated
  numbers, validated versions and timestamps, and `report-<n>` + SHA-256 prefix labels.
- **`--details`**: adds redacted, control-stripped, 200-char-limited free text per finding,
  and marks the output accordingly.
- **`--show-file-names`**: adds sanitized base names.
- Report data is never executed, evaluated, sent anywhere, or used to build a RegExp,
  command, path or URL.

## Not in 0.1.0

- Guard and Allocator reports (no stable report format yet).
- npm registry distribution -- install from GitHub (see Quick start).
- Recursive directory input (a directory input reads its direct `*.json` children only).

## Status

**Preview.** 0.1.0 is the first public release. Report input formats and the
summary/dashboard output formats may change before 1.0. The package is not published on
npm.
