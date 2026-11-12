// CLI output behaviour: exact file sets for build / badge, summary --out
// (including the input-file refusal), summary formats agreeing, --stable
// determinism, output-dir refusals mapped to exit 4 with path-free messages,
// and stdout/stderr EPIPE handling.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, readdirSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/real/', import.meta.url));
const PASS = join(FIXTURES, 'probe', 'probe-stdio-pass.json');
const WARN = join(FIXTURES, 'policy-gate', 'check-warn.json');
const FAIL = join(FIXTURES, 'policy-gate', 'check-fail.json');
const NO_DATA = join(FIXTURES, 'mock-server', 'session-report-default.json');

function makeIo(cwd, overrides = {}) {
  const out = [];
  const err = [];
  return {
    io: {
      stdout: overrides.stdout || { write: (s) => { out.push(String(s)); } },
      stderr: overrides.stderr || { write: (s) => { err.push(String(s)); } },
      cwd,
      env: {},
    },
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

async function run(argv, cwd, overrides) {
  const h = makeIo(cwd, overrides);
  const code = await main(argv, h.io);
  return { code, stdout: h.stdout(), stderr: h.stderr() };
}

function withTemp(t, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-out-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return fn(dir);
}

test('build writes exactly the fixed file set plus badges', async (t) => {
  await withTemp(t, async (tmp) => {
    const out = join(tmp, 'out');
    const r = await run(['build', PASS, '--out', out], tmp);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(readdirSync(out).sort(), ['.joons-report-hub-output', 'badges', 'index.html', 'summary.json', 'summary.md']);
    assert.deepEqual(readdirSync(join(out, 'badges')).sort(), ['overall.svg', 'probe.svg']);
  });
});

test('badge writes only badges and the marker', async (t) => {
  await withTemp(t, async (tmp) => {
    const out = join(tmp, 'out');
    const r = await run(['badge', FAIL, '--out', out], tmp);
    assert.equal(r.code, 1, r.stderr);
    assert.deepEqual(readdirSync(out).sort(), ['.joons-report-hub-output', 'badges']);
    assert.deepEqual(readdirSync(join(out, 'badges')).sort(), ['overall.svg', 'policy-gate.svg']);
  });
});

test('build reruns into its own marked directory', async (t) => {
  await withTemp(t, async (tmp) => {
    const out = join(tmp, 'out');
    const r1 = await run(['build', PASS, '--out', out], tmp);
    assert.equal(r1.code, 0);
    const r2 = await run(['build', WARN, '--out', out], tmp);
    assert.equal(r2.code, 0, r2.stderr);
  });
});

test('summary --out writes the chosen format to the file', async (t) => {
  await withTemp(t, async (tmp) => {
    const file = join(tmp, 'result.json');
    const r = await run(['summary', PASS, '--format', 'json', '--out', file], tmp);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '');
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(doc.format, 'joons-mcp-report-hub/summary');
    assert.equal(doc.overall.status, 'PASS');
  });
});

test('summary --out refuses to write over an input file (exit 4, no path in message)', async (t) => {
  await withTemp(t, async (tmp) => {
    const input = join(tmp, 'in.json');
    writeFileSync(input, readFileSync(PASS, 'utf8'), 'utf8');
    const r = await run(['summary', input, '--format', 'json', '--out', input], tmp);
    assert.equal(r.code, 4);
    assert.match(r.stderr, /refusing to write the summary over an input file/);
    assert.doesNotMatch(r.stderr, new RegExp(escapeRegExp(input)));
    assert.doesNotMatch(r.stderr, /in\.json/);
  });
});

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('output dir that exists as a file is refused with exit 4 and no path', async (t) => {
  await withTemp(t, async (tmp) => {
    const target = join(tmp, 'a-file');
    writeFileSync(target, 'x', 'utf8');
    const r = await run(['build', PASS, '--out', target], tmp);
    assert.equal(r.code, 4);
    assert.match(r.stderr, /joons-mcp-report-hub: /);
    assert.doesNotMatch(r.stderr, new RegExp(escapeRegExp(target)));
  });
});

test('non-empty foreign output dir refused without --force; accepted with --force', async (t) => {
  await withTemp(t, async (tmp) => {
    const out = join(tmp, 'out');
    mkdirSync(out);
    writeFileSync(join(out, 'foreign.txt'), 'keep me', 'utf8');
    const r = await run(['build', PASS, '--out', out], tmp);
    assert.equal(r.code, 4);
    assert.match(r.stderr, /not empty/);
    const r2 = await run(['build', PASS, '--out', out, '--force'], tmp);
    assert.equal(r2.code, 0, r2.stderr);
    assert.equal(readFileSync(join(out, 'foreign.txt'), 'utf8'), 'keep me');
  });
});

test('output dir overlapping input files is refused with exit 4', async (t) => {
  await withTemp(t, async (tmp) => {
    const input = join(tmp, 'in.json');
    writeFileSync(input, readFileSync(PASS, 'utf8'), 'utf8');
    const inside = join(tmp, 'out');
    mkdirSync(inside);
    writeFileSync(join(inside, 'stolen.json'), readFileSync(PASS, 'utf8'), 'utf8');
    const r = await run(['build', join(inside, 'stolen.json'), '--out', inside], tmp);
    assert.equal(r.code, 4);
    assert.match(r.stderr, /overlaps an input file/);
    const r2 = await run(['build', input, '--out', tmp], tmp);
    assert.equal(r2.code, 4);
  });
});

test('output dir with a symlink component is refused with exit 4', async (t) => {
  await withTemp(t, async (tmp) => {
    let linkTarget = join(tmp, 'real');
    mkdirSync(linkTarget);
    try {
      symlinkSync(linkTarget, join(tmp, 'link'), 'junction');
    } catch {
      t.skip('symlinks are not creatable in this environment');
      return;
    }
    const r = await run(['build', PASS, '--out', join(tmp, 'link', 'out')], tmp);
    assert.equal(r.code, 4);
    assert.match(r.stderr, /symbolic link/);
  });
});

test('summary terminal / json / markdown agree on the overall status', async (t) => {
  await withTemp(t, async (tmp) => {
    const terminal = await run(['summary', WARN, '--format', 'terminal'], tmp);
    const json = await run(['summary', WARN, '--format', 'json'], tmp);
    const markdown = await run(['summary', WARN, '--format', 'markdown'], tmp);
    assert.equal(terminal.code, 0);
    assert.match(terminal.stdout, /overall: WARN/);
    assert.equal(JSON.parse(json.stdout).overall.status, 'WARN');
    assert.match(markdown.stdout, /# MCP Report Hub: WARN/);
    assert.match(markdown.stdout, /Generated from JSON reports only; no MCP server was contacted\./);
  });
});

test('--stable makes JSON output byte-identical across runs', async (t) => {
  await withTemp(t, async (tmp) => {
    const a = await run(['summary', WARN, '--format', 'json', '--stable'], tmp);
    const b = await run(['summary', WARN, '--format', 'json', '--stable'], tmp);
    assert.equal(a.stdout, b.stdout);
    assert.equal(JSON.parse(a.stdout).generatedAt, null);
  });
});

test('a stdout write failure (EPIPE) maps to exit 4 and does not crash', async (t) => {
  await withTemp(t, async (tmp) => {
    const h = makeIo(tmp, {
      stdout: { write: () => { const e = new Error('broken pipe'); e.code = 'EPIPE'; throw e; } },
    });
    const code = await main(['summary', PASS], h.io);
    assert.equal(code, 4);
  });
});

test('a stderr write failure is ignored and does not change the exit code', async (t) => {
  await withTemp(t, async (tmp) => {
    const h = makeIo(tmp, {
      stderr: { write: () => { const e = new Error('broken pipe'); e.code = 'EPIPE'; throw e; } },
    });
    const code = await main(['summary', FAIL], h.io);
    assert.equal(code, 1);
  });
});

test('badge output dir cannot be created (nested under a file) maps to exit 4', async (t) => {
  await withTemp(t, async (tmp) => {
    const blocker = join(tmp, 'blocker');
    writeFileSync(blocker, 'x', 'utf8');
    const r = await run(['badge', PASS, '--out', join(blocker, 'sub')], tmp);
    assert.equal(r.code, 4);
    assert.doesNotMatch(r.stderr, /blocker/);
  });
});

test('--quiet suppresses the build completion line only', async (t) => {
  await withTemp(t, async (tmp) => {
    const quiet = await run(['build', PASS, '--out', join(tmp, 'q'), '--quiet'], tmp);
    assert.equal(quiet.code, 0);
    assert.equal(quiet.stdout, '');
    const loud = await run(['build', PASS, '--out', join(tmp, 'l')], tmp);
    assert.match(loud.stdout, /build complete \(overall: PASS\)/);
  });
});

test('build still writes outputs and exits 2 when no report is accepted', async (t) => {
  await withTemp(t, async (tmp) => {
    const bad = join(tmp, 'broken.json');
    writeFileSync(bad, '{ nope', 'utf8');
    const out = join(tmp, 'out');
    const r = await run(['build', bad, '--out', out], tmp);
    assert.equal(r.code, 2);
    assert.ok(existsSync(join(out, 'index.html')));
    assert.ok(existsSync(join(out, 'summary.json')));
  });
});
