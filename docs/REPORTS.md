# Report types: what Report Hub reads

This document describes, for every supported input report type, how it is detected,
exactly which fields are read, how they map to the normalized status/kind/level, and what
is dropped. This document and `docs/PRIVACY.md` are authoritative for behavior; `docs/SCHEMAS.md` is the survey of
the real formats. All formats are `schemaVersion: 1` today.

Conventions:

- **Dropped in default mode** means the value never reaches any output (HTML, SVG,
  Markdown, terminal, summary JSON). `--details` additionally allows the short free-text
  fields marked *(details)*, after `redactText` (control stripping, URL/path/e-mail/IP/
  secret redaction, 200-char truncation). `--show-file-names` adds the sanitized input base
  name.
- Unknown enum tokens become `unknown`; wrong **types** become a `malformed_report` problem
  (with a safe JSON-pointer path, no values). Missing values become `null` and are listed
  in `notAvailable`.
- Every status carries a **kind** so the six semantics are never conflated: `health`,
  `change_risk`, `policy`, `tests`, `recording`, `validation`.

## probe -> `probe_report` (kind: `health`, label "Server health")

- **Detection**: no `format` key; `schemaVersion === 1`; `tool.name === "joons-mcp-probe"`;
  has `status` and `target`.
- **Read**:
  - `status` in {PASS, WARNING, FAIL} -> `status.value`; level ok / warning / failure.
  - `tool.version` -> `productVersion` (must match the safe version pattern, else omitted).
  - `finishedAt` -> `timestamp` (ISO-8601, else null); `timings.totalMs` -> `durationMs`
    (finite number >= 0, else null).
  - `tools.count` -> `counts.tools`; `findings[]` severities -> `counts.findingsFail /
    findingsWarning / findingsInfo`.
  - `findings[]`: `id` validated against the known probe finding ids (else `unknown`);
    `severity` fail | warning (-> warn) | info; aggregated by (severity, code) with
    `count`. Details *(details)*: the finding's tool and message.
  - `failure` object -> one additional finding, severity fail, code `PROBE_FAILURE_<KIND>`
    (`failure.kind` as recorded; an unrecognized kind becomes `PROBE_FAILURE_UNKNOWN`);
    details *(details)*: `failure.message`.
- **Dropped**: `target` (command/args/url), `server.*`, `tools.items[]`, finding
  categories, `failure.step/exitCode/stderrTail`, `startedAt`, timings other than
  `totalMs`.

## diff -> `diff_result` (kind: `change_risk`, label "Change risk")

- **Detection**: `format === "joons-mcp-diff/result"`.
- **Read**:
  - `summary.risk` in {none, low, unknown, high} -> `status.value`; level none->ok,
    low->ok, unknown->warning, high->failure.
  - `summary.{added,removed,changed,unchanged,breaking,nonBreaking,unknown}` -> `counts`.
  - `tools[].changes[]`: aggregated by (severity, kind): BREAKING->fail, UNKNOWN->warn,
    NON_BREAKING->info; `code` = `kind` validated against the known diff change kinds
    (else `unknown`). Details *(details)*: tool + message.
  - **Consistency check**: `summary.breaking` must equal the number of BREAKING changes --
    and likewise for UNKNOWN / NON_BREAKING -- whenever the `tools` array is complete
    (unchanged tools may be omitted by the producer). A mismatch -> `malformed_report` at
    `/summary`; an inconsistent report is not trusted.
- **Dropped**: `before`/`after` descriptors (labels, server names), `renameHints`,
  `changes[].path/before/after` (arbitrary schema fragments), tool statuses.

## policy-gate -> `policy_check` (kind: `policy`, label "Policy compliance")

- **Detection**: `format === "joons-mcp-policy-gate/result"`.
- **Read**:
  - `verdict` in {PASS, WARN, FAIL} -> `status.value`; level ok / warning / failure.
  - `date` (`YYYY-MM-DD`, validated as a real date) -> `timestamp`.
  - `summary.{tools,fail,warn}` -> `counts`.
  - `findings[]`: aggregated by (level, rule), severity fail | warn; `code` = `rule`
    validated against the known policy rule ids (else `unknown`). Details *(details)*:
    tool + the finding's `message`.
  - **Consistency check**: `summary.fail` / `summary.warn` must equal the number of
    findings with that level, else `malformed_report`.
- **Dropped**: policy name/version, snapshot label/server, `classifications`, finding
  `class`/`detail` objects.

## policy-gate / mock-server / contract-runner -> `validation` (kind: `validation`, label "Input validation")

- **Detection**: `format` in {`joons-mcp-policy-gate/policy-validation`,
  `joons-mcp-mock-server/validation`, `joons-mcp-contract-test/validation`}. Note:
  mock-server validation reports carry `errors`/`warnings` as **plain strings**, while
  policy-gate and contract-runner carry **objects** with `path`/`message`; both shapes are
  read.
- **Read**:
  - `ok` true + no warnings -> `VALID` (level ok); `ok` true with warnings ->
    `VALID_WITH_WARNINGS` (level warning); `ok` false -> `INVALID` (level failure).
  - `counts.errors = errors.length`, `counts.warnings = warnings.length`.
  - Details *(details)*: error/warning messages (the string itself, or the object's
    `message`), redacted.
- **Findings**: none -- validation reports contribute counts and status only.
- **Dropped**: error/warning `path` fields, everything else.

## mock-server -> `mock_session` (kind: `recording`, label "Mock recording")

- **Detection**: `format === "joons-mcp-mock-server/report"`.
- **Read**:
  - `status.value = RECORDED`, level `info` -- always. A mock session report is a call
    **recording**; it has no verdict and Report Hub never fabricates one. It is shown as
    "Mock session recording (not a test result)" and can never turn anything green or red.
  - `totals.calls` -> `counts.calls`; `totals.byOutcome` -> `counts.byOutcome`, with
    unknown outcome keys summed into `unknown`; `droppedCalls` -> `counts.droppedCalls`.
  - `scenario` -> shown only in `--details` mode (redacted).
- **Findings**: none.
- **Dropped**: `server.mockOf`, the `tools` map (names and last arguments), `lastCall`,
  the `calls[]` array (arguments, sources, tool names).

## contract-runner -> `contract_run` (kind: `tests`, label "Test results")

- **Detection**: `format === "joons-mcp-contract-test/report"`.
- **Read**:
  - `verdict` in {PASS, FAIL} -> `status.value`; level ok / failure. (SKIP never fails a
    run.)
  - `summary.{total,passed,failed,skipped}` -> `counts`; `summary.durationMs` ->
    `durationMs`.
  - `results[]`: failing results contribute findings aggregated by assertion **name root**
    -- the part before the first `/` or `<`, validated against the known assertion roots
    (`outcome`, `isError`, `errorCode`, `errorMessageContains`, `text.equals`,
    `text.contains`, `text.startsWith`, `contentCount`, `structuredContent.equals`,
    `structuredContent.matches`, `fields`, `maxDurationMs`, `timeout`, `tool`,
    `tools.mustInclude`, `tools.mustNotInclude`; else `unknown`), severity fail. A failing
    result with a `reason` and no `failures` counts as code `reason`. Details *(details)*:
    test id + assertion + message.
  - **Consistency check**: `summary.total === results.length` and passed/failed/skipped
    must equal the number of results with that status, else `malformed_report`.
  - SKIP results are counted, never failures. `testSuccessRate` is computed across all
    contract_run reports: `FLOOR(100*passed/(passed+failed))` -- never rounded up to 100
    while a failure exists; null when `passed + failed = 0`.
- **Dropped**: `suite.name`, `target` (server name/title/version, protocol version),
  per-test durations, `failures[].expected/actual` (untrusted mock-response text).

## Recognized but not reports

| Input | Handling |
| --- | --- |
| `joons-mcp-diff/snapshot` | `ignored_input` -- it is an input *for* diff/policy-gate/mock-server/contract-runner, not a result. Never an error; listed in the problems section of the summary. |
| Guard / Allocator | Not supported in 0.1.0 (no stable report format). |

## Rejection taxonomy

| Problem kind | When |
| --- | --- |
| `invalid_json` | Unreadable / invalid JSON (detail: `line N column M` only) |
| `unknown_format` | Valid JSON that matches no known report fingerprint |
| `unsupported_version` | Known format with `schemaVersion !== 1` (detail: format + version number only) |
| `malformed_report` | Right type, wrong field types or failing a consistency check (detail: safe JSON pointer) |
| `limit_exceeded` | Size/depth/node/string limits breached |
| `duplicate` | Identical SHA-256 as an already-kept file (first by sorted path order wins; `--duplicates error` turns it into a rejected input) |
| `ignored_input` | `joons-mcp-diff/snapshot` files |
