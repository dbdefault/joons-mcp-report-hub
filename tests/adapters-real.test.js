// Adapter tests against every real fixture sample.
// Expectations (types, values, levels, counts) are derived by reading each sample file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { adaptReport } from '../src/adapters/index.js';
import { sha256Hex } from '../src/util/object.js';

const REAL = join('tests', 'fixtures', 'real');

function fixtureText(product, name) {
  return readFileSync(join(REAL, product, name), 'utf8');
}

function load(product, name) {
  return JSON.parse(fixtureText(product, name));
}

let seq = 0;
function identityFor(product, name, reportType) {
  seq += 1;
  const text = fixtureText(product, name);
  return {
    label: 'report-' + seq,
    sha256: sha256Hex(Buffer.from(text, 'utf8')),
    reportType,
    product,
    sourceFormat: reportType === 'probe_report' ? '(none)' : (JSON.parse(text).format ?? '(none)'),
  };
}

function adapt(product, name, reportType, options) {
  const value = load(product, name);
  const identity = identityFor(product, name, reportType);
  return { value, identity, result: adaptReport(value, identity, options) };
}

function mustOk(t) {
  assert.equal(t.result.ok, true, JSON.stringify(t.result));
  return t.result.report;
}

// ---------- probe ----------

const PROBE_LEVEL = { PASS: 'ok', WARNING: 'warning', FAIL: 'failure' };
const PROBE_FILES = [
  'probe-fail-bad-schema.json',
  'probe-fail-handshake.json',
  'probe-pass-redaction.json',
  'probe-pass-stdio.json',
  'probe-stdio-pass.json',
  'probe-warning-empty-tools.json',
];

for (const name of PROBE_FILES) {
  test('probe sample adapts: ' + name, () => {
    const raw = load('probe', name);
    const report = mustOk(adapt('probe', name, 'probe_report'));

    assert.equal(report.product, 'probe');
    assert.equal(report.reportType, 'probe_report');
    assert.equal(report.sourceFormat, '(none)');
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.status.kind, 'health');
    assert.equal(report.status.value, raw.status);
    assert.equal(report.status.level, PROBE_LEVEL[raw.status]);
    assert.equal(report.productVersion, raw.tool.version);
    assert.equal(report.timestamp, raw.finishedAt);
    assert.equal(report.durationMs, raw.timings.totalMs);
    assert.equal(report.counts.tools, raw.tools ? raw.tools.count : null);

    let fail = 0;
    let warning = 0;
    let info = 0;
    const expectedFindings = [];
    for (const f of raw.findings) {
      const sev = f.severity === 'warning' ? 'warn' : f.severity;
      if (sev === 'fail') fail += 1;
      else if (sev === 'warn') warning += 1;
      else info += 1;
      const existing = expectedFindings.find((e) => e.severity === sev && e.code === f.id);
      if (existing) existing.count += 1;
      else expectedFindings.push({ severity: sev, code: f.id, count: 1 });
    }
    if (raw.failure && typeof raw.failure === 'object') {
      fail += 1;
      const known = new Set(['handshake_failed', 'invalid_response', 'CLEANUP_INCOMPLETE', 'RESPONSE_TOO_DEEP']);
      const code = known.has(raw.failure.kind)
        ? 'PROBE_FAILURE_' + raw.failure.kind.toUpperCase()
        : 'PROBE_FAILURE_UNKNOWN';
      const existing = expectedFindings.find((e) => e.severity === 'fail' && e.code === code);
      if (existing) existing.count += 1;
      else expectedFindings.push({ severity: 'fail', code, count: 1 });
    }
    expectedFindings.sort((a, b) => {
      const rank = { fail: 0, warn: 1, info: 2 };
      return rank[a.severity] - rank[b.severity] || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    });
    assert.deepEqual(report.findings, expectedFindings);
    assert.equal(report.counts.findingsFail, fail);
    assert.equal(report.counts.findingsWarning, warning);
    assert.equal(report.counts.findingsInfo, info);
    for (const finding of report.findings) assert.equal('details' in finding, false);
  });
}

test('probe status mapping covers PASS, WARNING, FAIL', () => {
  const levels = PROBE_FILES.map((n) => mustOk(adapt('probe', n, 'probe_report')).status);
  const byValue = Object.fromEntries(levels.map((s) => [s.value, s.level]));
  assert.deepEqual(byValue, { PASS: 'ok', WARNING: 'warning', FAIL: 'failure' });
});

test('probe failure object adds PROBE_FAILURE_<KIND> finding', () => {
  const report = mustOk(adapt('probe', 'probe-fail-handshake.json', 'probe_report'));
  assert.deepEqual(report.findings, [
    { severity: 'fail', code: 'PROBE_FAILURE_HANDSHAKE_FAILED', count: 1 },
  ]);
  assert.equal(report.counts.tools, null);
  assert.equal(report.counts.findingsFail, 1);
  assert.deepEqual(report.notAvailable, []);
});

// ---------- diff ----------

const DIFF_LEVEL = { none: 'ok', low: 'ok', unknown: 'warning', high: 'failure' };
const DIFF_FILES = [
  'compare-examples.json',
  'compare-unchanged.json',
  'compare-v1-v2-breaking.json',
  'diff-compare-breaking.json',
  'diff-compare-examples-breaking.json',
  'diff-compare-no-changes.json',
];

for (const name of DIFF_FILES) {
  test('diff sample adapts: ' + name, () => {
    const raw = load('diff', name);
    const report = mustOk(adapt('diff', name, 'diff_result'));

    assert.equal(report.product, 'diff');
    assert.equal(report.reportType, 'diff_result');
    assert.equal(report.sourceFormat, 'joons-mcp-diff/result');
    assert.equal(report.status.kind, 'change_risk');
    assert.equal(report.status.value, raw.summary.risk);
    assert.equal(report.status.level, DIFF_LEVEL[raw.summary.risk]);
    assert.equal(report.productVersion, null);
    assert.equal(report.timestamp, null);
    assert.equal(report.durationMs, null);
    assert.deepEqual(report.notAvailable, ['timestamp', 'durationMs']);
    assert.deepEqual(report.counts, {
      added: raw.summary.added,
      removed: raw.summary.removed,
      changed: raw.summary.changed,
      unchanged: raw.summary.unchanged,
      breaking: raw.summary.breaking,
      nonBreaking: raw.summary.nonBreaking,
      unknown: raw.summary.unknown,
    });

    const sevMap = { BREAKING: 'fail', UNKNOWN: 'warn', NON_BREAKING: 'info' };
    const expected = [];
    for (const tool of raw.tools) {
      for (const change of tool.changes) {
        const sev = sevMap[change.severity];
        const existing = expected.find((e) => e.severity === sev && e.code === change.kind);
        if (existing) existing.count += 1;
        else expected.push({ severity: sev, code: change.kind, count: 1 });
      }
    }
    expected.sort((a, b) => {
      const rank = { fail: 0, warn: 1, info: 2 };
      return rank[a.severity] - rank[b.severity] || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    });
    assert.deepEqual(report.findings, expected);
  });
}

test('diff risk mapping: none/low -> ok, unknown -> warning, high -> failure', () => {
  const byValue = {};
  for (const name of DIFF_FILES) {
    const s = mustOk(adapt('diff', name, 'diff_result')).status;
    byValue[s.value] = s.level;
  }
  assert.equal(byValue.none, 'ok');
  assert.equal(byValue.high, 'failure');
  for (const risk of ['low', 'unknown']) {
    const raw = load('diff', 'compare-unchanged.json');
    raw.summary.risk = risk;
    const r = adaptReport(raw, identityFor('diff', 'compare-unchanged.json', 'diff_result'), {});
    assert.equal(r.report.status.value, risk);
    assert.equal(r.report.status.level, DIFF_LEVEL[risk]);
  }
});

// ---------- policy-gate ----------

const POLICY_LEVEL = { PASS: 'ok', WARN: 'warning', FAIL: 'failure' };

for (const name of ['check-fail.json', 'check-pass.json', 'check-warn.json', 'check-pass-failon-warning.json']) {
  test('policy check sample adapts: ' + name, () => {
    const raw = load('policy-gate', name);
    const report = mustOk(adapt('policy-gate', name, 'policy_check'));

    assert.equal(report.product, 'policy-gate');
    assert.equal(report.reportType, 'policy_check');
    assert.equal(report.status.kind, 'policy');
    assert.equal(report.status.value, raw.verdict);
    assert.equal(report.status.level, POLICY_LEVEL[raw.verdict]);
    assert.equal(report.timestamp, raw.date);
    assert.equal(report.durationMs, null);
    assert.deepEqual(report.counts, {
      tools: raw.summary.tools,
      fail: raw.summary.fail,
      warn: raw.summary.warn,
    });

    const expected = [];
    for (const f of raw.findings) {
      const existing = expected.find((e) => e.severity === f.level && e.code === f.rule);
      if (existing) existing.count += 1;
      else expected.push({ severity: f.level, code: f.rule, count: 1 });
    }
    expected.sort((a, b) =>
      (a.severity < b.severity ? -1 : a.severity > b.severity ? 1 : a.code < b.code ? -1 : 1));
    assert.deepEqual(report.findings, expected);
  });
}

test('policy verdict mapping covers PASS, WARN, FAIL', () => {
  const byValue = {};
  for (const name of ['check-fail.json', 'check-pass.json', 'check-warn.json']) {
    const s = mustOk(adapt('policy-gate', name, 'policy_check')).status;
    byValue[s.value] = s.level;
  }
  assert.deepEqual(byValue, { PASS: 'ok', WARN: 'warning', FAIL: 'failure' });
});

// ---------- mock-server ----------

for (const name of ['session-report-default.json', 'session-report-outage.json', 'session-report-protocol-error.json']) {
  test('mock session sample adapts (recording, never a verdict): ' + name, () => {
    const raw = load('mock-server', name);
    const report = mustOk(adapt('mock-server', name, 'mock_session'));

    assert.equal(report.product, 'mock-server');
    assert.equal(report.reportType, 'mock_session');
    assert.equal(report.status.kind, 'recording');
    assert.equal(report.status.value, 'RECORDED');
    assert.equal(report.status.level, 'info');
    assert.deepEqual(report.findings, []);
    assert.equal('scenario' in report, false);
    assert.equal(report.counts.calls, raw.totals.calls);
    assert.equal(report.counts.droppedCalls, raw.droppedCalls);
    assert.deepEqual(report.counts.byOutcome, raw.totals.byOutcome);
    assert.equal(JSON.stringify(report).includes('verdict'), false);
  });
}

// ---------- contract-runner ----------

const CONTRACT_LEVEL = { PASS: 'ok', FAIL: 'failure' };

for (const name of ['run-failing.json', 'run-mixed-fail-skip.json', 'run-outage-pass.json', 'run-outage-scenario.json', 'run-shop-pass.json']) {
  test('contract run sample adapts: ' + name, () => {
    const raw = load('contract-runner', name);
    const report = mustOk(adapt('contract-runner', name, 'contract_run'));

    assert.equal(report.product, 'contract-runner');
    assert.equal(report.reportType, 'contract_run');
    assert.equal(report.status.kind, 'tests');
    assert.equal(report.status.value, raw.verdict);
    assert.equal(report.status.level, CONTRACT_LEVEL[raw.verdict]);
    assert.deepEqual(report.counts, {
      total: raw.summary.total,
      passed: raw.summary.passed,
      failed: raw.summary.failed,
      skipped: raw.summary.skipped,
    });
    assert.equal(report.durationMs, raw.summary.durationMs);

    const expected = [];
    for (const result of raw.results) {
      if (result.status !== 'FAIL') continue;
      if (result.failures.length === 0) {
        if (typeof result.reason === 'string' && result.reason.length > 0) {
          const existing = expected.find((e) => e.code === 'reason');
          if (existing) existing.count += 1;
          else expected.push({ severity: 'fail', code: 'reason', count: 1 });
        }
        continue;
      }
      for (const failure of result.failures) {
        const root = failure.assertion.match(/^[^/<]*/)[0];
        const known = new Set(['outcome', 'isError', 'errorCode', 'errorMessageContains', 'text.equals', 'text.contains', 'text.startsWith', 'contentCount', 'structuredContent.equals', 'structuredContent.matches', 'fields', 'maxDurationMs', 'timeout', 'tool', 'tools.mustInclude', 'tools.mustNotInclude']);
        const code = known.has(root) ? root : 'unknown';
        const existing = expected.find((e) => e.code === code);
        if (existing) existing.count += 1;
        else expected.push({ severity: 'fail', code, count: 1 });
      }
    }
    expected.sort((a, b) => (a.code < b.code ? -1 : 1));
    assert.deepEqual(report.findings.map((f) => ({ severity: f.severity, code: f.code, count: f.count })), expected);
  });
}

test('contract run aggregates assertion roots and never counts SKIP as failure', () => {
  const report = mustOk(adapt('contract-runner', 'run-failing.json', 'contract_run'));
  assert.deepEqual(report.findings, [
    { severity: 'fail', code: 'fields', count: 1 },
    { severity: 'fail', code: 'text.equals', count: 1 },
    { severity: 'fail', code: 'tool', count: 1 },
  ]);
  assert.equal(report.counts.skipped, 1);
});

// ---------- validation (three products) ----------

const VALIDATION_CASES = [
  ['policy-gate', 'validate-policy-invalid.json', 'joons-mcp-policy-gate/policy-validation'],
  ['policy-gate', 'validate-policy-ok.json', 'joons-mcp-policy-gate/policy-validation'],
  ['policy-gate', 'validate-policy-valid.json', 'joons-mcp-policy-gate/policy-validation'],
  ['mock-server', 'validate-fixtures-invalid.json', 'joons-mcp-mock-server/validation'],
  ['mock-server', 'validate-fixtures-ok.json', 'joons-mcp-mock-server/validation'],
  ['mock-server', 'validate-fixtures-valid.json', 'joons-mcp-mock-server/validation'],
  ['mock-server', 'validate-invalid.json', 'joons-mcp-mock-server/validation'],
  ['mock-server', 'validate-ok.json', 'joons-mcp-mock-server/validation'],
  ['mock-server', 'validate-snapshot-invalid.json', 'joons-mcp-mock-server/validation'],
  ['mock-server', 'validate-snapshot-valid.json', 'joons-mcp-mock-server/validation'],
  ['contract-runner', 'validate-suite-invalid.json', 'joons-mcp-contract-test/validation'],
  ['contract-runner', 'validate-suite-ok.json', 'joons-mcp-contract-test/validation'],
  ['contract-runner', 'validate-suite-valid.json', 'joons-mcp-contract-test/validation'],
];

for (const [product, name, format] of VALIDATION_CASES) {
  test('validation sample adapts: ' + product + '/' + name, () => {
    const raw = load(product, name);
    const report = mustOk(adapt(product, name, 'validation'));

    assert.equal(report.product, product);
    assert.equal(report.reportType, 'validation');
    assert.equal(report.sourceFormat, format);
    assert.equal(report.status.kind, 'validation');
    if (raw.ok === false) {
      assert.equal(report.status.value, 'INVALID');
      assert.equal(report.status.level, 'failure');
    } else if (raw.warnings.length > 0) {
      assert.equal(report.status.value, 'VALID_WITH_WARNINGS');
      assert.equal(report.status.level, 'warning');
    } else {
      assert.equal(report.status.value, 'VALID');
      assert.equal(report.status.level, 'ok');
    }
    assert.deepEqual(report.counts, { errors: raw.errors.length, warnings: raw.warnings.length });
    assert.deepEqual(report.findings, []);
  });
}

test('validation status mapping: VALID, VALID_WITH_WARNINGS, INVALID', () => {
  const withWarnings = {
    format: 'joons-mcp-mock-server/validation',
    schemaVersion: 1,
    ok: true,
    errors: [],
    warnings: ['something odd'],
  };
  const r = adaptReport(withWarnings, {
    label: 'report-w', sha256: 'ab'.repeat(32), reportType: 'validation', product: 'mock-server', sourceFormat: 'joons-mcp-mock-server/validation',
  }, {});
  assert.equal(r.ok, true);
  assert.equal(r.report.status.value, 'VALID_WITH_WARNINGS');
  assert.equal(r.report.status.level, 'warning');
});

test('identity label and sha256 appear in every adapted report', () => {
  const { identity, result } = adapt('probe', 'probe-pass-stdio.json', 'probe_report');
  assert.equal(result.report.source.label, identity.label);
  assert.equal(result.report.source.sha256, identity.sha256.slice(0, 12));
  assert.equal(result.report.source.fileName, null);
});

test('diff snapshot files are data, not reports (identification contract)', () => {
  for (const name of ['diff-snapshot-before.json', 'diff-snapshot-after.json', 'snapshot-before-v1.json', 'snapshot-after-v2.json']) {
    const raw = load('diff', name);
    assert.equal(raw.format, 'joons-mcp-diff/snapshot');
  }
});
