# Security policy

## Scope and threat model

JOONS MCP Report Hub reads JSON report files produced by other tools (often describing
untrusted MCP servers) and turns them into summaries, a dashboard and badges. The
**adversarial input** is therefore the report file itself: tool names, server names,
messages, labels, paths, URLs, tokens, schema fragments and call arguments are all
attacker-controlled if the probed server or the pipeline that produced the report is
hostile.

Report Hub's defences, in order:

1. **No execution.** It never connects to an MCP server, never runs a tool or any other
   program, and makes no network request. No text from any input is executed, evaluated, or
   used to build a `RegExp`, command, path or URL.
2. **Allowlist by default.** Only fixed vocabulary, tokens from known sets, validated
   numbers, validated versions/timestamps and anonymous `report-<n>` + SHA-256 labels reach
   the output. Everything else is dropped. `--details` and `--show-file-names` are explicit
   opt-ins that add redacted/sanitized content and mark the output accordingly.
3. **Redaction.** In details mode, free text passes through `redactText`: fixed
   patterns that strip control/bidi characters and replace URLs, Windows/UNC/POSIX paths,
   e-mail addresses, IPv4 addresses, bearer/JWT/sensitive-name-value pairs and opaque
   tokens with `[URL]` / `[PATH]` / `[EMAIL]` / `[IP]` / `[MASKED]` / `[REDACTED]` markers.
   This is best-effort, not a guarantee of secret-free output. Split-field fragments may
   be recombined, so review opt-in details before sharing.
4. **Safe rendering.** The dashboard inserts every dynamic value only through `escapeHtml`
   into text nodes (never into `href`/`src`/`style`/event attributes or script/style
   content), ships a Content-Security-Policy meta tag with real SHA-256 hashes of its
   single inline style and script, references no external resource of any kind, and never
   embeds report data as JSON in the script. Badges use a fixed template with escaped text,
   no scripts, no external references and no event handlers. Markdown and terminal output
   escape or drop free text (no ANSI unless `--color` on a TTY).
5. **Prototype-pollution resistance.** Maps from report data are `Map` or
   `Object.create(null)`; fields are read with `hasOwn` + plain-object checks only.
6. **Limits.** 8 MiB per file, 64 MiB total, 500 files, JSON depth 64, 500,000 nodes,
   strings/keys at most 100,000 code units, at most 500 retained report entries; invalid
   UTF-8 is a fatal decode error. This bounds CPU and memory spent on hostile input.
7. **Output-directory safety.** `prepareOutputDir` refuses (exit 4) to write when the
   target exists and is not a directory, when any path component is a symlink or junction,
   when an input file lives inside the output directory, or when the directory is a
   non-empty foreign directory without the `.joons-report-hub-output` marker (unless
   `--force`; even with `--force` nothing is ever deleted). Only fixed file names are
   written, atomically (temp file + rename in the same directory).

## What we consider a vulnerability

- Any report content (strings, paths, tokens, markup) reaching an output where the contract
  says it must be dropped, redacted or escaped -- including the dashboard HTML, SVG badges,
  Markdown, terminal output and `summary.json`.
- Any network access, execution, or file access outside the contract (reading non-input
  files, writing outside the output directory, using report text as a path/URL/RegExp).
- CSP bypasses, prototype-pollution gadgets, output-directory escape, or limit bypasses
  (e.g. ReDoS in the fixed redaction regexes).
- Exit-code misreporting that lets a failing or rejected report look like a pass.

## Out of scope

- The security of the other JOONS products (report each in its own repository).
- Vulnerabilities requiring the attacker to already control the machine running Report Hub.

## Reporting a vulnerability

Please use **GitHub private vulnerability reporting** on
[dbdefault/joons-mcp-report-hub](https://github.com/dbdefault/joons-mcp-report-hub)
(Security tab -> "Report a vulnerability"). Do not open a public issue for security
reports. Include a minimal report file that triggers the problem and the command you ran;
our own test suite uses only fictional path/token values (e.g.
`C:\Users\example-user\...`, `ghp_EXAMPLE...`), and we ask that reports do the same.

We aim to acknowledge reports within a few days and to coordinate the fix and any public
disclosure with you.
