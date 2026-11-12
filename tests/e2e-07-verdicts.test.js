// E2E 7: overall verdict scenarios through the CLI, with exit codes.
//   all pass            -> PASS, exit 0
//   one failing         -> FAIL, exit 1
//   warning             -> WARN, exit 0 (and exit 1 with --fail-on warning)
//   mock only           -> NO_DATA, exit 0
//   no valid input      -> exit 2
//   --strict + rejected -> exit 2
//   INVALID validation  -> failure level -> FAIL, exit 1
//   --fail-on none      -> never fail on the verdict

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

function makeDir(t, entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-verdict-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  for (const [name, src] of entries) {
    fs.copyFileSync(path.join(REAL, src), path.join(dir, name));
  }
  return dir;
}

function overallOf(dir, ...extra) {
  const res = run(['summary', dir, '--format', 'json', ...extra]);
  let status = null;
  try {
    status = JSON.parse(res.stdout).overall.status;
  } catch {
    // no JSON on some error paths; status stays null
  }
  return { code: res.status, status };
}

test('all pass -> PASS, exit 0', (t) => {
  const dir = makeDir(t, [
    ['probe.json', 'probe/probe-pass-stdio.json'],
    ['policy.json', 'policy-gate/check-pass.json'],
    ['contract.json', 'contract-runner/run-outage-pass.json'],
    ['diff.json', 'diff/diff-compare-no-changes.json'],
  ]);
  const r = overallOf(dir);
  assert.equal(r.status, 'PASS');
  assert.equal(r.code, 0);
});

test('one failing report -> FAIL, exit 1; --fail-on none -> exit 0', (t) => {
  const dir = makeDir(t, [
    ['ok.json', 'probe/probe-pass-stdio.json'],
    ['bad.json', 'probe/probe-fail-handshake.json'],
  ]);
  const r = overallOf(dir);
  assert.equal(r.status, 'FAIL');
  assert.equal(r.code, 1);
  const relaxed = overallOf(dir, '--fail-on', 'none');
  assert.equal(relaxed.status, 'FAIL');
  assert.equal(relaxed.code, 0);
});

test('warning -> WARN, exit 0 by default and exit 1 with --fail-on warning', (t) => {
  const dir = makeDir(t, [
    ['warn.json', 'probe/probe-warning-empty-tools.json'],
    ['ok.json', 'policy-gate/check-pass.json'],
  ]);
  const r = overallOf(dir);
  assert.equal(r.status, 'WARN');
  assert.equal(r.code, 0);
  const strictish = overallOf(dir, '--fail-on', 'warning');
  assert.equal(strictish.status, 'WARN');
  assert.equal(strictish.code, 1);
});

test('mock recording only -> NO_DATA, exit 0', (t) => {
  const dir = makeDir(t, [['mock.json', 'mock-server/session-report-default.json']]);
  const r = overallOf(dir);
  assert.equal(r.status, 'NO_DATA');
  assert.equal(r.code, 0, 'NO_DATA with >= 1 accepted report does not fail');
});

test('no valid input (only an ignored snapshot) -> exit 2', (t) => {
  const dir = makeDir(t, [['snap.json', 'diff/diff-snapshot-before.json']]);
  const r = overallOf(dir);
  assert.equal(r.code, 2);
});

test('--strict with a rejected input -> exit 2 (and WARN, exit 0 without --strict)', (t) => {
  const dir = makeDir(t, [['ok.json', 'policy-gate/check-pass.json']]);
  fs.writeFileSync(path.join(dir, 'mystery.json'), JSON.stringify({ format: 'acme-corp/widget', schemaVersion: 1 }));
  const relaxed = overallOf(dir);
  assert.equal(relaxed.status, 'WARN', 'a rejected input can never produce PASS');
  assert.equal(relaxed.code, 0);
  const strict = overallOf(dir, '--strict');
  assert.equal(strict.code, 2);
});

test('INVALID validation report is failure-level -> FAIL, exit 1', (t) => {
  const dir = makeDir(t, [['invalid-policy.json', 'policy-gate/validate-policy-invalid.json']]);
  const r = overallOf(dir);
  assert.equal(r.status, 'FAIL');
  assert.equal(r.code, 1);
});

test('build and badge follow the same exit-code contract', (t) => {
  const passDir = makeDir(t, [['ok.json', 'probe/probe-pass-stdio.json']]);
  const failDir = makeDir(t, [['bad.json', 'probe/probe-fail-bad-schema.json']]);
  const mockDir = makeDir(t, [['mock.json', 'mock-server/session-report-default.json']]);

  const out1 = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-vout1-'));
  const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-vout2-'));
  const out3 = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-vout3-'));
  t.after(() => {
    for (const d of [out1, out2, out3]) fs.rmSync(d, { recursive: true, force: true });
  });

  assert.equal(run(['build', passDir, '--out', out1]).status, 0);
  assert.equal(run(['build', failDir, '--out', out2]).status, 1);
  assert.equal(run(['badge', mockDir, '--out', out3]).status, 0);
  assert.equal(run(['badge', failDir, '--out', out2, '--force']).status, 1);
});
