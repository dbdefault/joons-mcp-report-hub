// E2E 11: a mock-server session report is a call RECORDING, never a PASS/FAIL verdict.
//   - alone            -> overall NO_DATA, exit 0, kind "recording", value "RECORDED", info level;
//   - with a passing probe -> overall stays PASS (recordings never turn anything green/red);
//   - with a failing probe -> FAIL comes from the probe, the recording stays info;
//   - the badge shows a call count, never a verdict; unknown outcomes sum into "unknown".

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-mock-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  for (const [name, src] of entries) {
    fs.copyFileSync(path.join(REAL, src), path.join(dir, name));
  }
  return dir;
}

test('mock recording alone: NO_DATA, recording kind, never a verdict', (t) => {
  const dir = makeDir(t, [['mock.json', 'mock-server/session-report-default.json']]);
  const res = run(['summary', dir, '--format', 'json']);
  assert.equal(res.status, 0, 'NO_DATA with >= 1 accepted report exits 0');
  const s = JSON.parse(res.stdout);
  assert.equal(s.overall.status, 'NO_DATA');
  assert.ok(s.overall.reasons.includes('no_verdict_reports'));
  assert.equal(s.reports.length, 1);
  const r = s.reports[0];
  assert.equal(r.product, 'mock-server');
  assert.equal(r.reportType, 'mock_session');
  assert.equal(r.status.kind, 'recording');
  assert.equal(r.status.value, 'RECORDED');
  assert.equal(r.status.level, 'info');
  assert.equal(r.counts.calls, 5);
  // fixture outcomes: result 3, invalid_arguments 1, unknown_tool 1
  assert.equal(r.counts.byOutcome.result, 3);
  assert.equal(r.counts.byOutcome.invalid_arguments, 1);
  assert.equal(r.counts.byOutcome.unknown_tool, 1);
});

test('mock recording with a passing probe: overall stays PASS', (t) => {
  const dir = makeDir(t, [
    ['mock.json', 'mock-server/session-report-default.json'],
    ['ok.json', 'probe/probe-pass-stdio.json'],
  ]);
  const res = run(['summary', dir, '--format', 'json']);
  assert.equal(res.status, 0);
  const s = JSON.parse(res.stdout);
  assert.equal(s.overall.status, 'PASS');
  const mock = s.reports.find((r) => r.reportType === 'mock_session');
  assert.equal(mock.status.level, 'info');
});

test('mock recording with a failing probe: FAIL comes from the probe', (t) => {
  const dir = makeDir(t, [
    ['mock.json', 'mock-server/session-report-default.json'],
    ['bad.json', 'probe/probe-fail-handshake.json'],
  ]);
  const res = run(['summary', dir, '--format', 'json']);
  assert.equal(res.status, 1);
  const s = JSON.parse(res.stdout);
  assert.equal(s.overall.status, 'FAIL');
  assert.ok(s.overall.reasons.includes('failing_report'));
  const mock = s.reports.find((r) => r.reportType === 'mock_session');
  assert.equal(mock.status.value, 'RECORDED', 'the recording itself never fails');
});

test('dashboard and badges present the recording as a recording', (t) => {
  const dir = makeDir(t, [
    ['mock.json', 'mock-server/session-report-default.json'],
    ['ok.json', 'probe/probe-pass-stdio.json'],
  ]);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-mock-out-'));
  t.after(() => { fs.rmSync(out, { recursive: true, force: true }); });
  const res = run(['build', dir, '--out', out]);
  assert.equal(res.status, 0);

  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(html.includes('Mock session recording'), 'dashboard must label the recording');

  const mockBadge = fs.readFileSync(path.join(out, 'badges', 'mock-server.svg'), 'utf8');
  assert.ok(mockBadge.includes('5 calls'), 'mock badge shows the call count');
  assert.ok(!mockBadge.includes('PASS'), 'mock badge is never PASS');
  assert.ok(!mockBadge.includes('FAIL'), 'mock badge is never FAIL');
  assert.ok(!mockBadge.includes('WARN'), 'mock badge is never WARN');

  const term = run(['summary', dir]);
  assert.ok(term.stdout.includes('Mock recording'), 'terminal shows the kind label');
});

test('unknown mock outcomes are summed into "unknown"', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-mock-un-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const report = JSON.parse(
    fs.readFileSync(path.join(REAL, 'mock-server/session-report-default.json'), 'utf8')
  );
  report.totals.byOutcome['custom_outcome'] = 2; // not one of the seven known outcomes
  report.totals.calls += 2;
  fs.writeFileSync(path.join(dir, 'mock.json'), JSON.stringify(report, null, 2));

  const res = run(['summary', dir, '--format', 'json']);
  assert.equal(res.status, 0);
  const s = JSON.parse(res.stdout);
  const r = s.reports[0];
  assert.equal(r.counts.byOutcome.unknown, 2, 'unknown outcome keys sum into unknown');
  assert.equal(r.counts.calls, 7);
});
