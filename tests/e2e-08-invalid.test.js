// E2E 8: rejected inputs are classified exactly:
//   invalid JSON          -> invalid_json (detail: "line N column M")
//   unknown format        -> unknown_format
//   unsupported version   -> unsupported_version (detail: format + version)
//   wrong field type      -> malformed_report (detail: JSON pointer, e.g. /summary/tools)
//   inconsistent counts   -> malformed_report (detail: /summary)
//   duplicate bytes       -> problem duplicate (keep-first; --duplicates error rejects them)
// A rejected input never yields PASS; a directory with only rejected inputs exits 2.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'joons-mcp-report-hub.js');
const REAL = path.join(ROOT, 'tests', 'fixtures', 'real');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function load(rel) {
  return JSON.parse(fs.readFileSync(path.join(REAL, rel), 'utf8'));
}

function makeDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-invalid-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

function write(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

// one good report plus one bad file: exit 0 with WARN, JSON on stdout, exact problem kind
function mixedCase(t, name, badContent) {
  const dir = makeDir(t);
  fs.copyFileSync(path.join(REAL, 'policy-gate/check-pass.json'), path.join(dir, 'good.json'));
  write(dir, name, badContent);
  const res = run(['summary', dir, '--format', 'json']);
  assert.equal(res.status, 0, `expected WARN exit 0 for ${name}`);
  const s = JSON.parse(res.stdout);
  assert.equal(s.overall.status, 'WARN', `expected WARN for ${name}`);
  assert.ok(s.overall.reasons.includes('input_problem'), `expected input_problem for ${name}`);
  assert.equal(s.totals.rejected, 1, `expected 1 rejected for ${name}`);
  const problem = s.problems.find((p) => p.kind !== 'duplicate');
  return { s, problem };
}

test('invalid JSON -> invalid_json with line/column detail only', (t) => {
  const { problem } = mixedCase(t, 'broken.json', '{"format": "joons-mcp-diff/result", "schemaVersion": 1, ');
  assert.equal(problem.kind, 'invalid_json');
  assert.match(problem.detail, /^line \d+ column \d+$/);
});

test('unknown format -> unknown_format', (t) => {
  const { problem } = mixedCase(t, 'mystery.json', { format: 'acme-corp/widget', schemaVersion: 1 });
  assert.equal(problem.kind, 'unknown_format');
});

test('unsupported schemaVersion -> unsupported_version, detail names format and version', (t) => {
  const report = load('policy-gate/check-pass.json');
  report.schemaVersion = 2;
  const { problem } = mixedCase(t, 'future.json', report);
  assert.equal(problem.kind, 'unsupported_version');
  assert.ok(problem.detail.includes('joons-mcp-policy-gate/result'), 'detail should name the format');
  assert.ok(problem.detail.includes('2'), 'detail should name the version');
});

test('malformed field (wrong type) -> malformed_report with JSON pointer', (t) => {
  const report = load('policy-gate/check-pass.json');
  report.summary.tools = 'eight'; // must be a number
  const { problem } = mixedCase(t, 'typed.json', report);
  assert.equal(problem.kind, 'malformed_report');
  assert.ok(problem.detail.includes('/summary/tools'), `detail was ${problem.detail}`);
});

test('inconsistent counts -> malformed_report at /summary', (t) => {
  const report = load('policy-gate/check-fail.json'); // 5 fail findings
  report.summary.fail = 4; // lies about the finding count
  const { problem } = mixedCase(t, 'lying.json', report);
  assert.equal(problem.kind, 'malformed_report');
  assert.equal(problem.detail, '/summary');
});

test('inconsistent contract run counts -> malformed_report', (t) => {
  const report = load('contract-runner/run-shop-pass.json'); // 9 passed results
  report.summary.passed = 8;
  const { problem } = mixedCase(t, 'lying-contract.json', report);
  assert.equal(problem.kind, 'malformed_report');
  assert.ok(problem.detail.startsWith('/summary'));
});

test('only rejected inputs -> no accepted report -> exit 2', (t) => {
  const dir = makeDir(t);
  write(dir, 'mystery.json', { format: 'acme-corp/widget', schemaVersion: 1 });
  const res = run(['summary', dir, '--format', 'json']);
  assert.equal(res.status, 2);
  const bad = run(['validate', dir]);
  assert.equal(bad.status, 2, 'validate fails on unusable input');
});

test('duplicates: keep-first by default, rejected with --duplicates error', (t) => {
  const dir = makeDir(t);
  fs.copyFileSync(path.join(REAL, 'probe/probe-pass-stdio.json'), path.join(dir, 'a.json'));
  fs.copyFileSync(path.join(REAL, 'probe/probe-pass-stdio.json'), path.join(dir, 'b.json'));

  const res = run(['summary', dir, '--format', 'json']);
  assert.equal(res.status, 0, 'PASS set with a duplicate still exits 0');
  const s = JSON.parse(res.stdout);
  assert.equal(s.overall.status, 'PASS');
  assert.equal(s.totals.duplicates, 1);
  assert.equal(s.totals.reports, 1);
  assert.equal(s.problems.filter((p) => p.kind === 'duplicate').length, 1);

  const asError = run(['summary', dir, '--format', 'json', '--duplicates', 'error']);
  assert.equal(asError.status, 0, 'one accepted report remains, WARN by default');
  const se = JSON.parse(asError.stdout);
  assert.equal(se.overall.status, 'WARN');
  assert.equal(se.totals.rejected, 1);
  assert.equal(se.totals.reports, 1);

  const strict = run(['summary', dir, '--duplicates', 'error', '--strict']);
  assert.equal(strict.status, 2, 'strict turns rejected inputs into exit 2');

  assert.equal(run(['validate', dir]).status, 0, 'duplicates allowed by default');
  assert.equal(run(['validate', dir, '--duplicates', 'error']).status, 2);
});
