// buildSummary tests: overall rule, dedupe, ordering, per-product aggregation, rates.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { adaptReport } from '../src/adapters/index.js';
import { buildSummary } from '../src/model/aggregate.js';
import { sha256Hex } from '../src/util/object.js';

const REAL = join('tests', 'fixtures', 'real');

let seq = 0;
function adaptFixture(product, name, reportType, options = {}) {
  seq += 1;
  const text = readFileSync(join(REAL, product, name), 'utf8');
  const value = JSON.parse(text);
  const identity = {
    label: 'report-' + seq,
    sha256: sha256Hex(Buffer.from(text, 'utf8')),
    reportType,
    product,
    sourceFormat: value.format ?? '(none)',
  };
  const result = adaptReport(value, identity, options);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.report;
}

function probePass() {
  return adaptFixture('probe', 'probe-pass-stdio.json', 'probe_report');
}

function probeWarning() {
  return adaptFixture('probe', 'probe-warning-empty-tools.json', 'probe_report');
}

function probeFail() {
  return adaptFixture('probe', 'probe-fail-bad-schema.json', 'probe_report');
}

function diffHigh() {
  return adaptFixture('diff', 'compare-v1-v2-breaking.json', 'diff_result');
}

function policyWarn() {
  return adaptFixture('policy-gate', 'check-warn.json', 'policy_check');
}

function mockSession() {
  return adaptFixture('mock-server', 'session-report-default.json', 'mock_session');
}

function contractPass() {
  return adaptFixture('contract-runner', 'run-outage-pass.json', 'contract_run');
}

function contractFail() {
  return adaptFixture('contract-runner', 'run-failing.json', 'contract_run');
}

function problem(kind, shaPrefix, detail = 'line 3 column 5') {
  return { kind, source: { label: 'report-x', sha256: shaPrefix + '0'.repeat(12 - shaPrefix.length) }, detail };
}

test('all five products always present; zero reports -> level none', () => {
  const s = buildSummary([], [], { stable: true });
  assert.deepEqual(Object.keys(s.products), ['probe', 'diff', 'policy-gate', 'mock-server', 'contract-runner']);
  for (const p of Object.keys(s.products)) {
    assert.deepEqual(s.products[p], { reports: 0, level: 'none', worstStatus: null, counts: {} });
  }
  assert.equal(s.overall.status, 'NO_DATA');
  assert.deepEqual(s.overall.reasons, ['no_verdict_reports']);
  assert.deepEqual(s.testSuccessRate, { passed: 0, failed: 0, percent: null });
});

test('overall PASS when all accepted reports are ok', () => {
  const s = buildSummary([probePass(), contractPass()], [], { stable: true });
  assert.equal(s.overall.status, 'PASS');
  assert.deepEqual(s.overall.reasons, []);
  assert.equal(s.totals.reports, 2);
  assert.equal(s.totals.files, 2);
});

test('overall WARN with warning_report reason', () => {
  const s = buildSummary([probePass(), probeWarning()], [], { stable: true });
  assert.equal(s.overall.status, 'WARN');
  assert.deepEqual(s.overall.reasons, ['warning_report']);
});

test('overall WARN with input_problem reason only (never PASS with a rejected input)', () => {
  const s = buildSummary([probePass()], [problem('unknown_format', 'aa')], { stable: true });
  assert.equal(s.overall.status, 'WARN');
  assert.deepEqual(s.overall.reasons, ['input_problem']);
  assert.equal(s.totals.rejected, 1);
});

test('overall FAIL when one report fails among many passing', () => {
  const s = buildSummary([probePass(), contractPass(), policyWarn(), probeFail(), mockSession()], [], { stable: true });
  assert.equal(s.overall.status, 'FAIL');
  assert.deepEqual(s.overall.reasons, ['failing_report']);
});

test('overall WARN collects warning_report and input_problem together', () => {
  const s = buildSummary([probeWarning()], [problem('invalid_json', 'bb')], { stable: true });
  assert.equal(s.overall.status, 'WARN');
  assert.deepEqual(s.overall.reasons, ['warning_report', 'input_problem']);
});

test('overall NO_DATA with only mock recordings (info never turns green or red)', () => {
  const s = buildSummary([mockSession()], [], { stable: true });
  assert.equal(s.overall.status, 'NO_DATA');
  assert.deepEqual(s.overall.reasons, ['no_verdict_reports']);
  assert.equal(s.products['mock-server'].level, 'info');
  assert.equal(s.products['mock-server'].worstStatus, 'RECORDED');
});

test('mock recordings never turn a PASS into anything else, and never green by themselves', () => {
  const s = buildSummary([mockSession(), probePass()], [], { stable: true });
  assert.equal(s.overall.status, 'PASS');
  assert.equal(s.products['mock-server'].level, 'info');
  assert.equal(s.products.probe.level, 'ok');
});

test('product level is the worst (failure > warning > ok > info > none) with worstStatus', () => {
  const s = buildSummary([probePass(), probeWarning(), probeFail()], [], { stable: true });
  assert.equal(s.products.probe.reports, 3);
  assert.equal(s.products.probe.level, 'failure');
  assert.equal(s.products.probe.worstStatus, 'FAIL');
  const s2 = buildSummary([probePass(), probeWarning()], [], { stable: true });
  assert.equal(s2.products.probe.level, 'warning');
  assert.equal(s2.products.probe.worstStatus, 'WARNING');
});

test('counts are summed per product', () => {
  const s = buildSummary([probePass(), probeWarning()], [], { stable: true });
  assert.deepEqual(s.products.probe.counts, {
    tools: 2,
    findingsFail: 0,
    findingsWarning: 1,
    findingsInfo: 0,
  });
});

test('byOutcome maps are merged across mock sessions', () => {
  const a = adaptFixture('mock-server', 'session-report-default.json', 'mock_session');
  const b = adaptFixture('mock-server', 'session-report-outage.json', 'mock_session');
  const s = buildSummary([a, b], [], { stable: true });
  assert.deepEqual(s.products['mock-server'].counts.byOutcome, {
    invalid_arguments: 2,
    is_error: 1,
    result: 5,
    unknown_tool: 2,
  });
  assert.equal(s.products['mock-server'].counts.calls, 10);
});

test('duplicates keep-first: later identical bytes dropped with duplicate problem', () => {
  const a = probePass();
  const dup = { ...a, source: { label: 'report-99', sha256: a.source.sha256, fileName: null } };
  const s = buildSummary([a, dup, probeWarning()], [], { stable: true });
  assert.equal(s.totals.reports, 2);
  assert.equal(s.totals.duplicates, 1);
  assert.equal(s.totals.rejected, 0);
  assert.equal(s.overall.status, 'WARN');
  assert.equal(s.problems.filter((p) => p.kind === 'duplicate').length, 1);
  const dupProblem = s.problems.find((p) => p.kind === 'duplicate');
  assert.equal(dupProblem.source.label, 'report-99');
  assert.equal(typeof dupProblem.detail, 'string');
});

test('duplicates error: duplicates become rejected inputs and force WARN', () => {
  const a = probePass();
  const dup = { ...a, source: { label: 'report-98', sha256: a.source.sha256, fileName: null } };
  const s = buildSummary([a, dup], [], { stable: true, duplicates: 'error' });
  assert.equal(s.totals.duplicates, 0);
  assert.equal(s.totals.rejected, 1);
  assert.equal(s.overall.status, 'WARN');
  assert.deepEqual(s.overall.reasons, ['input_problem']);
  assert.equal(s.totals.reports, 1);
});

test('ignored inputs never warn and are counted separately', () => {
  const s = buildSummary([probePass()], [problem('ignored_input', 'cc', 'recognized non-report input')], { stable: true });
  assert.equal(s.overall.status, 'PASS');
  assert.equal(s.totals.ignored, 1);
  assert.equal(s.totals.rejected, 0);
});

test('ids are r1..rN in sorted order: product order, then type, then timestamp, then sha', () => {
  const probe = probePass();      // product 0
  const diff = diffHigh();        // product 1
  const policy = policyWarn();    // product 2
  const mock = mockSession();     // product 3
  const contract = contractPass();// product 4
  const s = buildSummary([contract, mock, policy, diff, probe], [], { stable: true });
  assert.deepEqual(s.reports.map((r) => r.id), ['r1', 'r2', 'r3', 'r4', 'r5']);
  assert.deepEqual(s.reports.map((r) => r.product),
    ['probe', 'diff', 'policy-gate', 'mock-server', 'contract-runner']);
});

test('order independence: shuffled entries produce identical stable summaries', () => {
  const entries = [
    probePass(), diffHigh(), policyWarn(), mockSession(), contractPass(),
    adaptFixture('contract-runner', 'run-shop-pass.json', 'contract_run'),
    adaptFixture('policy-gate', 'check-pass.json', 'policy_check'),
  ];
  const problems = [problem('unknown_format', 'dd'), problem('ignored_input', 'ee')];
  const a = buildSummary(entries, problems, { stable: true });
  const b = buildSummary([...entries].reverse(), [...problems].reverse(), { stable: true });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('stable option nulls generatedAt; without it an ISO timestamp is present', () => {
  const stable = buildSummary([probePass()], [], { stable: true });
  assert.equal(stable.generatedAt, null);
  const live = buildSummary([probePass()], [], {});
  assert.match(live.generatedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});

test('mode block reflects options', () => {
  const s = buildSummary([], [], { stable: true, details: true, showFileNames: true, duplicates: 'error' });
  assert.deepEqual(s.mode, { details: true, showFileNames: true, stable: true, duplicates: 'error' });
});

test('problems are sorted by kind, then source sha256, then detail', () => {
  const problems = [
    problem('unknown_format', 'ff'),
    problem('invalid_json', 'aa'),
    problem('unknown_format', 'bb'),
    problem('invalid_json', 'aa', 'line 9 column 1'),
  ];
  const s = buildSummary([], problems, { stable: true });
  assert.deepEqual(s.problems.map((p) => [p.kind, p.source.sha256, p.detail]), [
    ['invalid_json', 'aa0000000000', 'line 3 column 5'],
    ['invalid_json', 'aa0000000000', 'line 9 column 1'],
    ['unknown_format', 'bb0000000000', 'line 3 column 5'],
    ['unknown_format', 'ff0000000000', 'line 3 column 5'],
  ]);
});

test('testSuccessRate floor: 99 passed 1 failed is 99, never 100', () => {
  const results = [];
  for (let i = 0; i < 99; i += 1) results.push({ id: 'p' + i, status: 'PASS', failures: [] });
  results.push({ id: 'f1', status: 'FAIL', reason: null, failures: [{ assertion: 'tool' }] });
  const value = {
    format: 'joons-mcp-contract-test/report', schemaVersion: 1, verdict: 'FAIL',
    summary: { total: 100, passed: 99, failed: 1, skipped: 0, durationMs: 10 },
    results,
  };
  seq += 1;
  const adapted = adaptReport(value, {
    label: 'report-' + seq, sha256: 'e'.repeat(64), reportType: 'contract_run', product: 'contract-runner',
  }, {});
  assert.equal(adapted.ok, true);
  const s = buildSummary([adapted.report], [], { stable: true });
  assert.deepEqual(s.testSuccessRate, { passed: 99, failed: 1, percent: 99 });
});

test('testSuccessRate is 100 only when no failure exists; skipped excluded from denominator', () => {
  const value = {
    format: 'joons-mcp-contract-test/report', schemaVersion: 1, verdict: 'PASS',
    summary: { total: 3, passed: 2, failed: 0, skipped: 1, durationMs: 10 },
    results: [
      { id: 'a', status: 'PASS', failures: [] },
      { id: 'b', status: 'PASS', failures: [] },
      { id: 'c', status: 'SKIP', reason: 'capture unavailable', failures: [] },
    ],
  };
  seq += 1;
  const adapted = adaptReport(value, {
    label: 'report-' + seq, sha256: 'd'.repeat(64), reportType: 'contract_run', product: 'contract-runner',
  }, {});
  const s = buildSummary([adapted.report], [], { stable: true });
  assert.deepEqual(s.testSuccessRate, { passed: 2, failed: 0, percent: 100 });
});

test('testSuccessRate from real mixed fixtures sums across runs', () => {
  const a = adaptFixture('contract-runner', 'run-mixed-fail-skip.json', 'contract_run');
  const b = adaptFixture('contract-runner', 'run-failing.json', 'contract_run');
  const s = buildSummary([a, b], [], { stable: true });
  assert.deepEqual(s.testSuccessRate, { passed: 2, failed: 4, percent: 33 });
});

test('summary carries format, schemaVersion, tool and totals of all files', () => {
  const s = buildSummary([probePass()], [problem('malformed_report', 'ab', '/summary')], { stable: true });
  assert.equal(s.format, 'joons-mcp-report-hub/summary');
  assert.equal(s.schemaVersion, 1);
  assert.deepEqual(s.tool, { name: 'joons-mcp-report-hub', version: '0.1.0' });
  assert.deepEqual(s.totals, { files: 2, reports: 1, duplicates: 0, ignored: 0, rejected: 1 });
});

test('status kind travels with every value in reports', () => {
  const s = buildSummary([probePass(), diffHigh(), policyWarn(), mockSession(), contractPass()], [], { stable: true });
  const kinds = Object.fromEntries(s.reports.map((r) => [r.product, r.status.kind]));
  assert.deepEqual(kinds, {
    probe: 'health',
    diff: 'change_risk',
    'policy-gate': 'policy',
    'mock-server': 'recording',
    'contract-runner': 'tests',
  });
});
