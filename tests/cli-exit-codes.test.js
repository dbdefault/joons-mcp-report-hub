// CLI exit-code matrix: build / summary / badge x PASS / WARN / FAIL / NO_DATA
// x --fail-on none / failure / warning, plus --strict, zero accepted reports,
// duplicates and validate semantics.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/real/', import.meta.url));
const PASS = join(FIXTURES, 'probe', 'probe-stdio-pass.json');
const WARN = join(FIXTURES, 'policy-gate', 'check-warn.json');
const FAIL = join(FIXTURES, 'policy-gate', 'check-fail.json');
const NO_DATA = join(FIXTURES, 'mock-server', 'session-report-default.json');
const INVALID_JSON = join(FIXTURES, 'contract-runner', 'validate-suite-invalid.json');
const SNAPSHOT = join(FIXTURES, 'diff', 'diff-snapshot-before.json');

function makeIo(cwd) {
  const out = [];
  const err = [];
  return {
    io: {
      stdout: { write: (s) => { out.push(String(s)); } },
      stderr: { write: (s) => { err.push(String(s)); } },
      cwd,
      env: {},
    },
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

async function run(argv, cwd) {
  const h = makeIo(cwd);
  const code = await main(argv, h.io);
  return { code, stdout: h.stdout(), stderr: h.stderr() };
}

function withTemp(t, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return fn(dir);
}

const CASES = [
  ['PASS', PASS, { none: 0, failure: 0, warning: 0 }],
  ['WARN', WARN, { none: 0, failure: 0, warning: 1 }],
  ['FAIL', FAIL, { none: 0, failure: 1, warning: 1 }],
  ['NO_DATA', NO_DATA, { none: 0, failure: 0, warning: 0 }],
];

for (const command of ['summary', 'build', 'badge']) {
  for (const [name, fixture, expected] of CASES) {
    for (const failOn of ['none', 'failure', 'warning']) {
      test(`${command}: ${name} summary with --fail-on ${failOn} exits ${expected[failOn]}`, async (t) => {
        await withTemp(t, async (tmp) => {
          const argv = [command, fixture, '--fail-on', failOn];
          if (command !== 'summary') argv.push('--out', join(tmp, 'out'));
          const r = await run(argv, tmp);
          assert.equal(r.code, expected[failOn], `stdout=${r.stdout} stderr=${r.stderr}`);
        });
      });
    }
  }
}

test('NO_DATA with an accepted report exits 0 (mock recording only)', async (t) => {
  await withTemp(t, async (tmp) => {
    const r = await run(['summary', NO_DATA], tmp);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /overall: NO_DATA/);
  });
});

test('zero accepted reports exits 2', async (t) => {
  await withTemp(t, async (tmp) => {
    const bad = join(tmp, 'broken.json');
    writeFileSync(bad, '{ not json', 'utf8');
    const r = await run(['summary', bad], tmp);
    assert.equal(r.code, 2);
    const r2 = await run(['summary', SNAPSHOT], tmp);
    assert.equal(r2.code, 2);
  });
});

test('--strict with a rejected input exits 2; without --strict it is a WARN (0)', async (t) => {
  await withTemp(t, async (tmp) => {
    const bad = join(tmp, 'broken.json');
    writeFileSync(bad, '{ not json', 'utf8');
    const strict = await run(['summary', PASS, bad, '--strict'], tmp);
    assert.equal(strict.code, 2);
    const lenient = await run(['summary', PASS, bad], tmp);
    assert.equal(lenient.code, 0);
    assert.match(lenient.stdout, /overall: WARN/);
  });
});

test('--strict does not fail on ignored snapshots or keep-first duplicates', async (t) => {
  await withTemp(t, async (tmp) => {
    const dup = join(tmp, 'copy.json');
    writeFileSync(dup, JSON.stringify({ format: 'joons-mcp-mock-server/report', schemaVersion: 1, mock: true, server: { mockOf: 'x', snapshotToolCount: 1 }, scenario: 's', totals: { calls: 1, byOutcome: { result: 1 } }, tools: {}, lastCall: null, calls: [], droppedCalls: 0 }), 'utf8');
    const dup2 = join(tmp, 'copy2.json');
    writeFileSync(dup2, JSON.stringify({ format: 'joons-mcp-mock-server/report', schemaVersion: 1, mock: true, server: { mockOf: 'x', snapshotToolCount: 1 }, scenario: 's', totals: { calls: 1, byOutcome: { result: 1 } }, tools: {}, lastCall: null, calls: [], droppedCalls: 0 }), 'utf8');
    const r = await run(['summary', dup, dup2, SNAPSHOT, '--strict'], tmp);
    assert.equal(r.code, 0, r.stderr);
    const r2 = await run(['summary', dup, dup2, '--duplicates', 'error', '--strict'], tmp);
    assert.equal(r2.code, 2);
  });
});

test('duplicate inputs are counted, not rejected, by default', async (t) => {
  await withTemp(t, async (tmp) => {
    const out = join(tmp, 'out');
    const r = await run(['build', PASS, PASS, '--out', out], tmp);
    assert.equal(r.code, 0, r.stderr);
    const { readFileSync } = await import('node:fs');
    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    assert.equal(summary.totals.duplicates, 1);
    assert.equal(summary.totals.rejected, 0);
  });
});

test('validate: all inputs usable exits 0, duplicates and snapshots allowed', async (t) => {
  await withTemp(t, async (tmp) => {
    const r = await run(['validate', PASS, SNAPSHOT], tmp);
    assert.equal(r.code, 0);
  });
});

test('validate: any unusable input exits 2', async (t) => {
  await withTemp(t, async (tmp) => {
    const bad = join(tmp, 'broken.json');
    writeFileSync(bad, '{ not json', 'utf8');
    const r = await run(['validate', PASS, bad], tmp);
    assert.equal(r.code, 2);
    const only = await run(['validate', bad], tmp);
    assert.equal(only.code, 2);
  });
});

test('validate: a failing-verdict report is still a usable input (exit 0)', async (t) => {
  await withTemp(t, async (tmp) => {
    const r = await run(['validate', FAIL], tmp);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /usable/);
  });
});

test('an input argument that resolves to nothing exits 2', async (t) => {
  await withTemp(t, async (tmp) => {
    const r = await run(['summary', PASS, join(tmp, 'does-not-exist.json')], tmp);
    assert.equal(r.code, 2);
    assert.doesNotMatch(r.stderr, /does-not-exist/);
    const v = await run(['validate', join(tmp, 'does-not-exist.json')], tmp);
    assert.equal(v.code, 2);
  });
});

test('inputs resolving to zero files exit 2, not 3', async (t) => {
  await withTemp(t, async (tmp) => {
    mkdirSync(join(tmp, 'empty'));
    const r = await run(['summary', join(tmp, 'empty')], tmp);
    assert.equal(r.code, 2);
  });
});

test('mixed products aggregate to FAIL when any report fails', async (t) => {
  await withTemp(t, async (tmp) => {
    const r = await run(['summary', PASS, WARN, NO_DATA], tmp);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /overall: WARN/);
    const r2 = await run(['summary', PASS, FAIL, NO_DATA], tmp);
    assert.equal(r2.code, 1);
    assert.match(r2.stdout, /overall: FAIL/);
  });
});

test('directory input reads direct *.json children sorted', async (t) => {
  await withTemp(t, async (tmp) => {
    const dir = join(tmp, 'reports');
    mkdirSync(dir);
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ format: 'joons-mcp-mock-server/report', schemaVersion: 1, mock: true, server: { mockOf: 'x', snapshotToolCount: 1 }, scenario: 's', totals: { calls: 2, byOutcome: { result: 2 } }, tools: {}, lastCall: null, calls: [], droppedCalls: 0 }), 'utf8');
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ format: 'joons-mcp-mock-server/report', schemaVersion: 1, mock: true, server: { mockOf: 'x', snapshotToolCount: 1 }, scenario: 's', totals: { calls: 1, byOutcome: { result: 1 } }, tools: {}, lastCall: null, calls: [], droppedCalls: 0 }), 'utf8');
    writeFileSync(join(dir, 'ignore.txt'), 'not json', 'utf8');
    const r = await run(['summary', dir], tmp);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /reports: 2/);
  });
});

test('validate --format json reports per-file usability without paths', async (t) => {
  await withTemp(t, async (tmp) => {
    const bad = join(tmp, 'broken-secret-name.json');
    writeFileSync(bad, '{ not json', 'utf8');
    const r = await run(['validate', PASS, bad, '--format', 'json'], tmp);
    assert.equal(r.code, 2);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.usable, 1);
    assert.equal(doc.unusable, 1);
    const broken = doc.results.find((entry) => !entry.usable);
    assert.equal(broken.kind, 'invalid_json');
    assert.doesNotMatch(r.stdout, /broken-secret-name/);
  });
});

test('unknown format and unsupported version become input problems', async (t) => {
  await withTemp(t, async (tmp) => {
    const unknown = join(tmp, 'unknown.json');
    writeFileSync(unknown, JSON.stringify({ format: 'some-tool/result', schemaVersion: 1 }), 'utf8');
    // An input with zero accepted reports always exits 2.
    const alone = await run(['summary', unknown], tmp);
    assert.equal(alone.code, 2);
    // Mixed with a usable report it is a rejected input: WARN by default.
    const mixed = await run(['summary', unknown, PASS], tmp);
    assert.equal(mixed.code, 0);
    assert.match(mixed.stdout, /overall: WARN/);
    const strict = await run(['summary', unknown, PASS, '--strict'], tmp);
    assert.equal(strict.code, 2);
    const badVersion = join(tmp, 'version.json');
    writeFileSync(badVersion, JSON.stringify({ format: 'joons-mcp-diff/result', schemaVersion: 2 }), 'utf8');
    const r2 = await run(['summary', badVersion, PASS], tmp);
    assert.equal(r2.code, 0);
    assert.match(r2.stderr, /unsupported_version/);
    assert.doesNotMatch(r2.stderr, /some-tool/);
  });
});
