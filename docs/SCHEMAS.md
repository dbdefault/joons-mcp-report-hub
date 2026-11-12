# JOONS MCP Report Hub — Schema Survey

Survey date: 2026-11-12. All findings below come from real runs of the five products in
the five products (versions 0.1.0 each) plus their source code, cited as `file:line`.
Sample files live in `samples/<product>/` and are byte-exact real outputs. Every report is
UTF-8 JSON with `schemaVersion: 1` unless stated otherwise.

Conclusion up front: all five products DO have at least one machine-readable JSON report
format. None of the five is without one.

Shared input format worth noting for the hub: `joons-mcp-policy-gate`, `joons-mcp-mock-server`
and `joons-mcp-contract-runner` all consume the Diff snapshot format
(`format: "joons-mcp-diff/snapshot"`, `schemaVersion: 1`) as an input file.

Legend for "presence": **always** = present in every observed output (may be `null`);
**optional** = appears only in some outputs.

---

## 1. joons-mcp-probe 0.1.0

### Report type: Probe report (JSON)
Machine-readable output of `probe` (`stdio`/`http`). Written via `--json-out FILE`, or stdout
with `--format json`. Human-oriented Markdown (`--md-out`, default stdout) also exists but is not
machine-readable.

- `format` string: **absent**. The report has no `format` key; identification is via
  `schemaVersion: 1` plus `tool.name` (`src/probe.js:44`, `src/report/json.js:6`).
- `schemaVersion`: number, always `1`.

Top-level keys (order per `src/report/json.js:6`):

| Key | Type | Presence | Notes |
| --- | --- | --- | --- |
| `schemaVersion` | number | always | `1` |
| `tool` | object | always | `{name: "joons-mcp-probe", version: "0.1.0"}` |
| `startedAt`, `finishedAt` | string (ISO 8601) | always | |
| `target` | object | always | `{transport: "stdio"\|"http", command?: string, args?: string[], url?: string}` — `command`/`args` for stdio, `url` for http |
| `status` | string | always | enum: `PASS` \| `WARNING` \| `FAIL` |
| `server` | object \| null | always | null when the handshake never completed |
| `server.name` | string | if server | untrusted free text from the server |
| `server.version` | string | if server | untrusted free text |
| `server.protocolVersion` | string | if server | e.g. `"2025-11-25"` |
| `server.capabilities` | object | if server | shape depends on server |
| `server.instructionsPresent` | boolean | if server | |
| `timings` | object | always | `{connectMs, initializeMs, toolsListMs, totalMs}` — all number, `toolsListMs` observed `null` on failure |
| `tools` | object \| null | always | null on failure |
| `tools.count` | number | if tools | |
| `tools.pages` | number | if tools | tool-list pages followed (max 50) |
| `tools.items[]` | array | if tools | `{name: string, hasDescription: boolean, schemaValid: boolean}` — `name` is untrusted server text |
| `findings` | array | always | may be empty |
| `findings[].id` | string | always | e.g. `TOOLS_EMPTY`, `TOOL_SCHEMA_NOT_OBJECT`, `SECRET_IN_RESPONSE` |
| `findings[].severity` | string | always | enum: `warning` \| `fail` |
| `findings[].category` | string | always | e.g. `tools`, `schema`, `security`, `connection` |
| `findings[].message` | string | always | untrusted-capable free text (redacted) |
| `findings[].tool` | string | optional | tool name the finding relates to |
| `failure` | object \| null | always | null unless the probe itself failed |
| `failure.kind` | string | if failure | e.g. `handshake_failed`; README also documents `invalid_response`, `CLEANUP_INCOMPLETE`, `RESPONSE_TOO_DEEP` |
| `failure.step` | string | if failure | e.g. `initialize`, `connect` |
| `failure.message` | string | if failure | may embed server/child text (redacted) |
| `failure.exitCode` | number \| null | if failure | child exit code if any |
| `failure.stderrTail` | string | if failure | child stderr tail — untrusted free text |

Verdict definition (`src/probe.js:158`): `FAIL` if `failure` is set or any finding has
`severity === "fail"`; else `WARNING` if any finding has `severity === "warning"`; else `PASS`.

Exit codes (`src/cli.js:45`, README): 0 = PASS, or WARNING with default `--fail-on fail`;
1 = WARNING with `--fail-on warning`; 2 = FAIL; 3 = usage error; 4 = output error. Usage
errors (e.g. `stdio` with no command) print plain text to stderr and write no report.

Untrusted free text: `server.*`, `tools.items[].name`, `findings[].message`,
`failure.message`, `failure.stderrTail`. Supplied secrets (`--header`, `--env`) are masked as
substrings in all free text (README; verified with `probe-pass-redaction.json`: the env secret
never appears, and a `SECRET_IN_RESPONSE` finding is emitted instead).

Local paths / URLs / hostnames / secrets: `target.command`/`target.args` can carry local file
paths of the probed child; `target.url` (http transport) can carry URL/host and is redacted of
userinfo/query values per README.

### What this report means
Probe = the health of ONE real MCP server at ONE moment. It connects over stdio or Streamable
HTTP, negotiates the protocol, reads `tools/list`, validates tool schemas, and reports
PASS/WARNING/FAIL with timings. It is a live, read-only inspection of a real process — the
opposite of a recording.

---

## 2. joons-mcp-diff 0.1.0

Two machine-readable outputs: the **snapshot** file and the **compare result**.

### Report type: Snapshot (`snapshot stdio|http`)
Written with `-o FILE` (or stdout). `format: "joons-mcp-diff/snapshot"`, `schemaVersion: 1`.

| Key | Type | Presence | Notes |
| --- | --- | --- | --- |
| `format` | string | always | `joons-mcp-diff/snapshot` |
| `schemaVersion` | number | always | `1` |
| `createdAt` | string (ISO 8601) | always | |
| `tool` | object | always | `{name, version}` |
| `label` | string \| null | always | user-supplied text; never a secret per README |
| `server` | object | always | `{name, version, protocolVersion}` — name/version untrusted server text |
| `stats` | object | always | `{pages: number, toolCount: number, duplicateNames?: string[]}` — `duplicateNames` only when the server listed duplicate tool names |
| `tools` | array | always | sorted by name |
| `tools[].name` | string | always | |
| `tools[].title` | string \| null | always | |
| `tools[].description` | string \| null | always | untrusted server text |
| `tools[].inputSchema` | object \| null | always | recursively key-sorted |
| `tools[].outputSchema` | object \| null | always | |
| `tools[].annotations` | object \| null | always | |

By design the snapshot never stores: command, arguments, cwd, env names/values, URL, headers,
tokens, stderr, timings, hostnames (README "Snapshot format"). Label is user-supplied free text.

### Report type: Compare result (`compare BEFORE AFTER --format json`)
Written with `--json-out FILE` or stdout. `format: "joons-mcp-diff/result"`, `schemaVersion: 1`.

| Key | Type | Presence | Notes |
| --- | --- | --- | --- |
| `format` | string | always | `joons-mcp-diff/result` |
| `schemaVersion` | number | always | `1` |
| `before`, `after` | object | always | `{label, server: {name, protocolVersion, version}, toolCount}` |
| `summary` | object | always | see below |
| `summary.added/removed/changed/unchanged/breaking/nonBreaking/unknown` | number | always | |
| `summary.risk` | string | always | enum: `none` \| `low` \| `unknown` \| `high` (`src/diff/compare.js:36`) |
| `tools` | array | always | empty when nothing changed |
| `tools[].name` | string | always | |
| `tools[].status` | string | always | enum: `added` \| `removed` \| `changed` (only changed/added/removed appear) |
| `tools[].changes[]` | array | always | `{kind, message, path, severity, before: any, after: any}` |
| `changes[].severity` | string | always | enum: `BREAKING` \| `NON_BREAKING` \| `UNKNOWN` |
| `changes[].kind` | string | always | e.g. `tool_removed`, `tool_added`, `enum_values_removed`, `required_added`, `constraint_changed`, `property_added`, `description_changed` |
| `changes[].path` | string | always | JSON-pointer-ish path, `""` for whole-tool changes |
| `changes[].before` / `after` | any | always | arbitrary schema fragments — untrusted data |
| `renameHints` | array | always | may be empty; `[{from, to, similarity: number, reason: string}]` |

`--all`, `--no-rename-hints`, `--quiet` alter content; without `--all`, unchanged tools are
omitted (observed: `tools: []` and `unchanged: 4` for identical snapshots).

Verdict: there is no single verdict field — risk is the summary, and the exit code encodes the
threshold decision (`src/cli.js:45`): 0 = changes below `--fail-on` threshold; 1 = at/above it
(`breaking`: any BREAKING; `unknown`: BREAKING or UNKNOWN; `any`: any change; `none`: never);
2 = operational failure / unreadable or invalid snapshot (plain stderr text, e.g.
`missing.json: cannot read snapshot` — no JSON emitted); 3 = usage error; 4 = output error.

Untrusted free text/data: `label`, `server.name/version`, `tools[].changes[].before/after`
(arbitrary values copied from server schemas), tool names in `renameHints`. Secrets supplied via
`--header`/`--secret-env` are masked in untrusted text (README).

### What this report means
Diff = change risk between two points in time, as BREAKING / NON_BREAKING / UNKNOWN. It says
nothing about a live server; it classifies whether previously valid tool calls may now be
rejected (BREAKING), are still fine (NON_BREAKING), or cannot be classified safely (UNKNOWN —
not "safe"). Rename hints are suggestions, never applied renames.

---

## 3. joons-mcp-policy-gate 0.1.0

Two machine-readable outputs: **check result** and **policy validation**.

### Report type: Check result (`check SNAPSHOT --policy POLICY --format json`)
Written with `--json-out FILE` or stdout. `format: "joons-mcp-policy-gate/result"`,
`schemaVersion: 1`.

| Key | Type | Presence | Notes |
| --- | --- | --- | --- |
| `format` | string | always | `joons-mcp-policy-gate/result` |
| `schemaVersion` | number | always | `1` |
| `verdict` | string | always | enum: `PASS` \| `WARN` \| `FAIL` |
| `date` | string | always | `YYYY-MM-DD` (evaluation date) |
| `policy` | object | always | `{name: string, policyVersion: number}` |
| `snapshot` | object | always | `{label, server: {name, version}, toolCount}` — label/name untrusted |
| `summary` | object | always | `{tools: number, fail: number, warn: number, rules: string[]}` |
| `summary.rules` | string[] | always | rules that were active for this evaluation; observed set: `tool_denied`, `tool_not_allowed`, `description_missing`, `description_too_short`, `input_schema_invalid`, `annotations_missing`, `approval_missing`, `approval_expired`, `required_tool_missing`, `max_tools_exceeded`, `approval_unused` |
| `findings` | array | always | may be empty |
| `findings[].rule` | string | always | one of the rule ids above |
| `findings[].level` | string | always | `fail` \| `warn` |
| `findings[].tool` | string | always | tool name |
| `findings[].class` | string \| null | always | risk class id or null |
| `findings[].message` | string | always | e.g. `Description is missing.`, `Tool matches a deny pattern.` |
| `findings[].detail` | object | always | may be empty `{}`; e.g. `{pattern: "*_issue"}` |
| `classifications` | array | always | may be empty |
| `classifications[].tool` | string | always | |
| `classifications[].classes` | string[] | always | risk class ids matched |
| `classifications[].approval` | string | always | enum: `not_required` \| `valid` \| `expired` \| `missing` (`src/engine/evaluate.js:83,121`) |

Verdict (`src/engine/evaluate.js:141`): `FAIL` if any fail-level finding, else `WARN` if any
warn-level finding, else `PASS`.

Exit codes (`src/cli.js:88`, README): 0 = below threshold; 1 = threshold reached (default
`--fail-on failure`; `warning` also fails on WARN; `none` never fails); 2 = input/validation/
time-limit error (plain stderr text, e.g. `joons-mcp-policy-gate: cannot read snapshot file`,
no JSON); 3 = usage error; 4 = output error.

Untrusted free text: `snapshot.label`, `snapshot.server.name`, tool names (all copied from the
snapshot file, which can be untrusted input). `findings[].message`/`detail` are
product-generated from policy config. No paths/URLs/hostnames/secrets appear by design — the
gate reads local JSON only (README "Security model").

### Report type: Policy validation (`validate-policy POLICY --format json`)
`format: "joons-mcp-policy-gate/policy-validation"`, `schemaVersion: 1`.
Keys: `format`, `schemaVersion`, `ok: boolean`, `errors: [{path: string, message: string}]`,
`warnings: [{path: string, message: string}]`. Observed messages: `Unknown key.`,
`policy enables no checks; risk classes without requireApproval only label tools`,
`this rule can never produce a finding`.

### What this report means
Policy Gate = policy compliance of ONE recorded snapshot, evaluated statically. PASS/WARN/FAIL
measure whether the snapshot's tool list violates your written policy (deny/allow patterns,
required tools, metadata rules, risk-class approvals). It does not connect to a server and does
not block tool calls at runtime.

---

## 4. joons-mcp-mock-server 0.1.0

Two machine-readable outputs: **validation** (`validate`, `validate-fixtures`) and the
**session report** (`start --report FILE`).

### Report type: Validation
`format: "joons-mcp-mock-server/validation"`, `schemaVersion: 1`. Single-line JSON on stdout
with `--format json`.

| Key | Type | Presence |
| --- | --- | --- |
| `format` | string | always (`joons-mcp-mock-server/validation`) |
| `schemaVersion` | number | always `1` |
| `ok` | boolean | always |
| `errors` | string[] | always (may be empty) |
| `warnings` | string[] | always (may be empty) |

Note the difference from policy-gate/contract-runner validation: here `errors`/`warnings` are
plain strings (e.g. `"/tools/get_product/default/surpriseKey : unknown key"`), not objects.
Exit: 0 = valid (warnings still exit 0); 2 = invalid input; 3 = usage error.

### Report type: Session report (`start ... --report FILE`)
Written atomically on shutdown (stdin EOF / SIGINT / SIGTERM). `format:
"joons-mcp-mock-server/report"`, `schemaVersion: 1` (`src/server/recorder.js:38`).

| Key | Type | Presence | Notes |
| --- | --- | --- | --- |
| `format` | string | always | `joons-mcp-mock-server/report` |
| `schemaVersion` | number | always | `1` |
| `mock` | boolean | always | always `true` |
| `server` | object | always | `{mockOf: string, snapshotToolCount: number}` — `mockOf` is the snapshot's server name (untrusted) |
| `scenario` | string | always | e.g. `default`, `checkout-outage` |
| `totals` | object | always | `{calls: number, byOutcome: object}` — `byOutcome` maps outcome → count |
| `tools` | object | always | map tool name → `{calls: number, lastArguments: object}`; unknown tools grouped under `"<unknown tools>"` |
| `lastCall` | object \| null | always | `{seq, tool, outcome, arguments}` or null if no calls |
| `calls` | array | always | first 1,000 calls only: `[{seq: number, tool: string, outcome: string, source: string, arguments: object}]` |
| `droppedCalls` | number | always | calls beyond the 1,000-call cap |

Outcome enum (observed + `src/server/runtime.js:51-76`): `result`, `is_error`,
`protocol_error`, `unknown_tool`, `invalid_arguments`, `timeout`, `busy`.
Source enum (`src/server/responder.js:13-23`, `runtime.js`): `fixture_match`, `fixture_default`,
`fixture_scenario`, `builtin_scenario`, `fail_tool`, `missing_fixture`, `validation`, `limit`.

Argument handling: values of sensitive keys are replaced with `"[MASKED]"` at any depth — key
list in `src/server/recorder.js:3` (`password, passwd, secret, token, apikey, api_key, api-key,
authorization, auth, credential, cookie, session, privatekey, private_key`, case-insensitive,
plus `--mask-key NAME`). Strings truncated at 1,000 chars, depth at 16 (`[TRUNCATED]`). Verified
in `session-report-outage.json`: `"session": "[MASKED]"`.

Exit codes: 0 = normal shutdown or valid input; 2 = invalid input or configuration; 3 = usage
error; 4 = report write failure.

Untrusted data: `tools` map keys and `calls[].tool` (caller-supplied names; unknown tool names
sanitized to 100 chars), `calls[].arguments` / `tools[].lastArguments` (caller-supplied
arguments, masked/truncated). No local paths, URLs or hostnames appear.

### What this report means
Mock Server's report = a call-recording of a mock session, not a test result. It says which
tools were called, with what (masked) arguments, and what happened (fixture hit, validation
failure, protocol error, unknown tool). `mock: true` marks it as mock-derived data. It must not
be read as "the system passed/failed" — contract-runner is the product that turns mock
behaviour into PASS/FAIL verdicts.

---

## 5. joons-mcp-contract-runner 0.1.0

Runs only against a JOONS MCP Mock Server in 0.1.0 (identity-checked before any call).
Two machine-readable outputs: **run report** and **suite validation**.

### Report type: Run report (`run SUITE ... --format json`)
Written with `--json-out FILE` or stdout. `format: "joons-mcp-contract-test/report"`,
`schemaVersion: 1` (`src/engine/run.js:175`).

| Key | Type | Presence | Notes |
| --- | --- | --- | --- |
| `format` | string | always | `joons-mcp-contract-test/report` |
| `schemaVersion` | number | always | `1` |
| `verdict` | string | always | enum: `PASS` \| `FAIL` (SKIP never fails a run) |
| `suite` | object | always | `{name?: string, tests: number}` — `name` omitted when the suite has none |
| `target` | object | always | `{type: "mock", server: {name, title, version}, protocolVersion}` |
| `summary` | object | always | `{total, passed, failed, skipped, durationMs}` — `total` includes the synthetic `#tools` result |
| `results` | array | always | in suite order |
| `results[].id` | string | always | test id, or the literal `#tools` for tool-inclusion checks (`src/engine/run.js:119`) |
| `results[].tool` | string | optional | absent on the `#tools` synthetic result |
| `results[].status` | string | always | enum: `PASS` \| `FAIL` \| `SKIP` |
| `results[].durationMs` | number | always | 0 under `--stable` |
| `results[].reason` | string \| null | always | observed: `capture unavailable` (SKIP), `tool not listed` (FAIL), `timeout` (FAIL), else null |
| `results[].failures` | array | always | `[{assertion, expected, actual, message}]`; empty on PASS/SKIP |
| `failures[].assertion` | string | if failures | e.g. `text.equals`, `fields/price.type`, `tool`, `timeout` |
| `failures[].expected` / `actual` | any | if failures | `actual` can be untrusted mock-response text (sanitized) |

Capture hygiene: captures are omitted from reports, and any captured value appearing in other
free text is replaced with `[CAPTURED]` (`src/engine/run.js:8,48`). Verified: test id
`search-boots` is reported as `search-[CAPTURED]` because `boots` was a captured value
(`run-shop-pass.json`). Arguments are omitted and sensitive keys masked (README).

Verdict (`src/engine/run.js:174-175`): `FAIL` if any result failed, else `PASS`.
Exit codes (`src/cli.js:72`, README): 0 = PASS (or `--fail-on none`); 1 = FAIL verdict; 2 =
invalid input, mock unavailable, startup or identity failure (a run stopped here prints
`joons-mcp-contract-test: invalid suite file; run validate to inspect errors` on stderr and
writes no report); 3 = usage error; 4 = output write error.

Untrusted free text: `failures[].actual` (comes from mock responses), `suite.name` (redacted),
`target.server.title` (from the mock server's identity). Local paths can appear only in CLI
arguments, never inside the report.

### Report type: Suite validation (`validate SUITE --format json`)
`format: "joons-mcp-contract-test/validation"`, `schemaVersion: 1`.
Keys: `format`, `schemaVersion`, `ok: boolean`, `errors: [{path: string, message: string}]`,
`warnings: [{path: string, message: string}]`. Observed: `Unknown key`,
`Capture must refer to an earlier test` (error); `Tool not present in snapshot` (warning).

### What this report means
Contract Runner = behavioural test results against a mock. Each test calls one tool on the mock
and asserts outcome/text/structuredContent/fields/duration/error. Results are PASS/FAIL/SKIP
per test with a run verdict; it answers "did the mock behave as the suite expects", not "is the
real server healthy" (0.1.0 cannot target real servers).

---

## Hub-facing summary

| Product | Report format string | schemaVersion | Verdict field | Exit-code meaning source |
| --- | --- | --- | --- | --- |
| probe | (none) | 1 | `status` PASS/WARNING/FAIL | threshold + status |
| diff snapshot | `joons-mcp-diff/snapshot` | 1 | n/a (file is data) | n/a |
| diff compare | `joons-mcp-diff/result` | 1 | none (risk + counts) | threshold vs summary |
| policy-gate check | `joons-mcp-policy-gate/result` | 1 | `verdict` PASS/WARN/FAIL | threshold vs verdict |
| policy-gate validate | `joons-mcp-policy-gate/policy-validation` | 1 | `ok` | 0 valid / 2 invalid |
| mock-server validate | `joons-mcp-mock-server/validation` | 1 | `ok` | 0 valid / 2 invalid |
| mock-server report | `joons-mcp-mock-server/report` | 1 | none (outcome counts) | session exit codes |
| contract run | `joons-mcp-contract-test/report` | 1 | `verdict` PASS/FAIL | verdict |
| contract validate | `joons-mcp-contract-test/validation` | 1 | `ok` | 0 valid / 2 invalid |

Common gotchas for the dashboard:
- probe report has NO `format` key; everything else has one.
- Validation `errors`/`warnings` are objects in policy-gate and contract-runner, but plain
  strings in mock-server.
- diff risk level `unknown` is a risk value, separate from the change severity `UNKNOWN`.
- policy-gate `WARN` and contract-runner `SKIP` are non-failing middle states; probe has three
  states where the other products have two.
- Error paths (missing/unreadable input files) exit 2 with plain stderr text and no JSON, for
  diff compare, policy-gate check, probe usage errors, and contract-runner run.

Note: two files found in `samples/` (`policy-gate/check-pass-failon-warning.json`,
`policy-gate/validate-policy-ok.json`) were produced by a parallel process sharing this folder,
not by the commands recorded here; they are excluded from `SAMPLES_INDEX.md`.
