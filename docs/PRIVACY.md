# Privacy model

Report Hub's core promise: **report content is never copied through.** The default output
is an allowlist, and the only opt-ins are `--details` (redacted free text per finding) and
`--show-file-names` (sanitized base names). This document lists, field by field, what can
reach the output.

## The allowlist (default mode)

Only these value classes may appear in any output (HTML, SVG, Markdown, terminal, summary
JSON):

| Value class | Examples |
| --- | --- |
| Fixed vocabulary chosen by Report Hub | product ids, report types, status values, levels, problem kinds, section labels |
| Enumerated tokens from a known set | probe `status`, finding `severity`, probe finding `id`, diff `risk`, diff change `kind`, policy rule ids, contract assertion roots, mock `outcome` -- an unknown token is replaced by `unknown` |
| Integers 0..1,000,000,000 and finite durations >= 0 | counts, `durationMs`, `calls`, `droppedCalls` |
| Product versions matching `^[0-9]{1,6}(\.[0-9]{1,6}){0,3}(-[0-9A-Za-z.]{1,24})?$` | e.g. `0.1.0`; invalid or missing probe versions are omitted |
| Timestamps | ISO-8601, or probe/policy `YYYY-MM-DD` validated as a real date; else null |
| Source labels | `report-<n>` plus the first 12 hex chars of the file's SHA-256 |

**Everything else from a report is dropped in default mode** -- tool names, server names
and versions, messages, labels, paths, URLs, command lines, arguments, stderr tails, error
text, suite/test ids, schema fragments, call arguments.

## Field-by-field

| Source field (by report type) | Default mode | `--details` mode |
| --- | --- | --- |
| probe `status` | mapped to value + level (ok/warning/failure) | same |
| probe `tool.version` | validated version string or omitted | same |
| probe `finishedAt`, `timings.totalMs` | validated timestamp / duration or null | same |
| probe `tools.count` | integer or null | same |
| probe `findings[].id` | known id, else `unknown` | same |
| probe `findings[].severity` | fail/warn/info | same |
| probe `findings[].tool`, `findings[].message` | **dropped** | allowed: control-stripped, redacted, at most 200 chars |
| probe `failure.kind` / `failure.message` | kind -> finding code `PROBE_FAILURE_<KIND>` (unrecognized -> `PROBE_FAILURE_UNKNOWN`); message **dropped** | message allowed, redacted |
| probe `target`, `server.*`, `tools.items[]`, `failure.step/exitCode/stderrTail` | **dropped** | `failure.stderrTail` stays dropped |
| diff `summary.risk` | value (none/low/unknown/high) + level | same |
| diff `summary.*` counts | integers | same |
| diff `tools[].changes[]` (severity, kind) | aggregated findings; kind validated, else `unknown` | same |
| diff `tools[].name`, `changes[].message` | **dropped** | allowed, redacted |
| diff `before/after` labels, `renameHints`, `changes[].path/before/after` | **dropped** | **dropped** |
| policy `verdict`, `date` | value + level; validated date | same |
| policy `summary.{tools,fail,warn}` | integers | same |
| policy `findings[].rule` | known rule id, else `unknown` | same |
| policy `findings[].tool`, `findings[].message` | **dropped** | allowed, redacted |
| policy `policy.*`, `snapshot.*`, `classifications`, `findings[].detail` | **dropped** | **dropped** |
| contract `verdict` | value + level | same |
| contract `summary.{total,passed,failed,skipped,durationMs}` | integers / duration | same |
| contract failing results' assertion root | validated known root, else `unknown`; `reason` code when no failures | same |
| contract `results[].id`, `failures[].assertion`, `failures[].message` | **dropped** | allowed, redacted |
| contract `suite.name`, `target.*`, `failures[].expected/actual` | **dropped** | **dropped** (expected/actual can carry untrusted mock text) |
| mock `totals.calls`, `totals.byOutcome` (known outcomes), `droppedCalls` | integers; unknown outcome keys summed into `unknown` | same |
| mock `scenario` | **dropped** | allowed, redacted |
| mock `server.mockOf`, `tools` map, `lastCall`, `calls[]` | **dropped** | **dropped** |
| validation `ok`, `errors.length`, `warnings.length` | value (VALID / VALID_WITH_WARNINGS / INVALID) + level; counts | same |
| validation error/warning messages | **dropped** | allowed, redacted (string messages or object `message`) |
| validation error/warning `path` | **dropped** | **dropped** |
| input file name | `report-<n>` + SHA-256 prefix only | with `--show-file-names`: sanitized base name; never a directory |

In `--details` mode every output is marked "details: may contain internal names". Redaction
is best-effort and never guarantees secret-free output. Split-field fragments such as a
subject containing `sk-` and a message containing `FAKE000` can be recombined. Review
details before sharing. In
`--show-file-names` mode the sanitized base name replaces (or accompanies -- see summary
`source.fileName`) the anonymous label; the directory is never shown.

## Redaction rules (`redactText`)

Applied in this order with fixed regular expressions; no RegExp is built from input:

1. Strip control characters: C0, DEL, C1, bidi/format characters (U+200E/F, U+202A-U+202E,
   U+2066-U+2069, U+061C), U+2028/2029, ESC.
2. Build a detection view by removing Unicode `Cf` characters, U+180E, U+115F,
   U+1160, U+3164, U+FFA0, U+034F, U+FE00-U+FE0F and U+E0000-U+E007F,
   and decoding valid `%XX` bytes.
   Mask original spans for normalized credential prefixes and Bearer tokens, and for
   base64/base64url runs of at least eight characters that decode to a credential prefix
   followed by six non-whitespace characters, or `Bearer` followed by whitespace and at
   least six non-whitespace characters. Remove the listed format characters.
3. URLs (`scheme://...`) -> `[URL]`.
4. Windows drive and UNC paths -> `[PATH]`.
5. POSIX absolute paths with at least two segments and `~/...` -> `[PATH]`.
6. E-mail addresses -> `[EMAIL]`; IPv4 addresses -> `[IP]`.
7. Bearer tokens -> `Bearer [TOKEN]`; JWTs -> `[TOKEN]`.
8. Sensitive name-value pairs for password, passwd, secret, token, apikey, api_key,
   api-key, authorization, auth, credential, cookie, session, privatekey and private_key
   (including their bounded suffixes) -> `name=[MASKED]`, when quotes are symmetric.
9. Credential-prefix tokens (`sk-`, `ghp_`, `gho_`, `github_pat_`, `AKIA`, `xoxb-`,
   `xoxa-`, `xoxp-`, `glpat-`) with at least six non-whitespace characters -> `[REDACTED]`.
10. Opaque runs of 24 or more `[A-Za-z0-9_+/=-]` characters -> `[REDACTED]`.
11. Truncate to the maximum length, ending with `...`.

## What is never output

- Paths, URLs, e-mail addresses, IP addresses and tokens in default-mode free text are
  dropped. Details redaction replaces recognized patterns, but can miss secrets.
- Input file **directories** and any absolute path of the machine that produced the
  reports.
- Raw report JSON embedded in the dashboard (no `application/json` script blocks, no data
  attributes carrying report content).
- Anything from a rejected file: rejected inputs contribute a problem kind, an anonymous
  source label and a safe `detail` string (JSON pointer, `line N column M`, or format +
  version) -- never content.
