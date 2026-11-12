# Contributing

Thanks for helping improve JOONS MCP Report Hub.

## Ground rules

- **Zero dependencies.** No runtime or dev dependencies, ever. Do not add anything to
  `package.json`'s `dependencies`/`devDependencies` and do not install packages. If you
  think a dependency is needed, open an issue first.
- **Node.js >= 20, ESM, no build step.** Source is plain JavaScript ESM.
- **Safety is the product.** Any change that lets report content bypass the allowlist, the
  redaction rules, the escaping, the limits or the output-directory protections is a bug
  even if it "works".
- **Never conflate statuses.** The six status kinds (`health`, `change_risk`, `policy`,
  `tests`, `recording`, `validation`) must stay distinct in every renderer.
- Source files are ASCII only; non-ASCII is allowed in Korean docs (`README.ko.md` and
  other Korean documentation).

## Setup

There is nothing to install. Clone the repository and run:

```bash
node scripts/test.js
```

The test suite is `node:test` + `node:assert/strict`, run through `scripts/test.js`.

## Layout

- `bin/joons-mcp-report-hub.js`, `src/cli.js`, `src/args.js` -- CLI entry and argument
  parsing
- `src/input/` -- reading, collecting and identifying inputs
- `src/security/` -- escaping and redaction
- `src/adapters/` -- one adapter per report type
- `src/model/` -- normalization helpers and aggregation
- `src/render/` -- json/markdown/terminal/html/svg renderers
- `src/output/` -- output-directory protection and atomic writes
- `tests/fixtures/real/` -- byte-exact real outputs of the five sister products
  (**do not modify or delete**); new synthetic fixtures may be added under `tests/fixtures/`
- `tests/e2e-*.test.js` -- end-to-end tests through the CLI

## Adding tests

- Every real fixture in `tests/fixtures/real/` must keep passing: each file is accepted as
  its expected type, or classified as `ignored_input` (snapshots) / `duplicate` -- never as
  an error.
- New adversarial tests (injection, planted secrets, prototype keys, oversize/deep inputs)
  must use **obviously fictional** path/token values:
  `C:\Users\example-user\project\x.js`, `/home/example-user/project/x.js`,
  `ghp_EXAMPLE0123456789abcdefghijklmn`,
  `https://user:pass@internal.example.invalid/x?token=abc`. Never use real hosts, IPs,
  people, e-mail addresses or real local paths.
- Tests create their own temporary directories and clean them up; they must not write
  outside the temp area and must not touch the network.

## Pull request checklist

- [ ] `node scripts/test.js` passes locally on your platform.
- [ ] You ran the CLI end-to-end for the paths you changed (see `examples/README.md`).
- [ ] New behaviour is documented in the relevant `docs/*.md` / README section.
- [ ] No new dependencies, no non-ASCII in source files, fictional test data only.
- [ ] `CHANGELOG.md` has an entry (use `Unreleased` until a release is cut).

## Releases

- Versioning follows the behavior documented in `docs/REPORTS.md` and `docs/PRIVACY.md`; 0.1.x is **Preview** and input/output
  formats may change before 1.0.
- CI (`.github/workflows/ci.yml`) runs the test suite and CLI smoke checks on
  ubuntu/windows/macos with Node 20/22/24 on every push and pull request.
