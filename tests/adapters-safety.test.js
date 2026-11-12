// Adapter safety tests: hostile strings, prototype pollution, unknown tokens,
// malformed types, inconsistent counts, details-mode redaction.

import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptReport } from '../src/adapters/index.js';

let seq = 0;
function identity(reportType, product, sourceFormat) {
  seq += 1;
  return {
    label: 'report-' + seq,
    sha256: String(seq).padStart(4, '0') + 'f'.repeat(60),
    reportType,
    product,
    sourceFormat: sourceFormat ?? '(none)',
  };
}

function baseProbe(overrides = {}) {
  return {
    schemaVersion: 1,
    tool: { name: 'joons-mcp-probe', version: '0.1.0' },
    status: 'PASS',
    finishedAt: '2026-11-12T14:26:17.773Z',
    timings: { totalMs: 1030 },
    tools: { count: 1 },
    findings: [],
    failure: null,
    ...overrides,
  };
}

const HOSTILE_TOOL = '<script>alert(1)</script>"onload=';
const HOSTILE_MESSAGE = 'run at C:\\Users\\example-user\\x.js with ghp_EXAMPLE0123456789abcdefghijklmn';

// ---------- hostile strings never pass through ----------

test('probe: hostile tool/message absent in default mode, redacted in details mode', () => {
  const value = baseProbe({
    status: 'WARNING',
    findings: [{ id: 'SECRET_IN_RESPONSE', severity: 'warning', message: HOSTILE_MESSAGE, tool: HOSTILE_TOOL }],
  });
  const def = adaptReport(value, identity('probe_report', 'probe'), {});
  assert.equal(def.ok, true);
  const defText = JSON.stringify(def.report);
  for (const bad of ['<script>', 'onload=', 'example-user', 'ghp_EXAMPLE']) {
    assert.equal(defText.includes(bad), false, 'default mode leaks: ' + bad);
  }

  const det = adaptReport(value, identity('probe_report', 'probe'), { details: true });
  const detText = JSON.stringify(det.report);
  assert.equal(detText.includes('example-user'), false);
  assert.equal(detText.includes('ghp_EXAMPLE'), false);
  assert.equal(detText.includes('[PATH]'), true);
  assert.equal(detText.includes('[REDACTED]'), true);
  const finding = det.report.findings[0];
  assert.equal(finding.details[0].subject, HOSTILE_TOOL); // tool name allowed in details mode
});

test('diff: hostile tool name and change message are redacted in details mode only', () => {
  const value = {
    format: 'joons-mcp-diff/result',
    schemaVersion: 1,
    summary: { added: 0, removed: 1, changed: 0, unchanged: 0, breaking: 1, nonBreaking: 0, unknown: 0, risk: 'high' },
    tools: [{
      name: HOSTILE_TOOL,
      status: 'removed',
      changes: [{ kind: 'tool_removed', severity: 'BREAKING', message: HOSTILE_MESSAGE }],
    }],
  };
  const def = adaptReport(value, identity('diff_result', 'diff'), {});
  assert.equal(def.ok, true);
  const defText = JSON.stringify(def.report);
  for (const bad of ['<script>', 'onload=', 'example-user', 'ghp_EXAMPLE']) {
    assert.equal(defText.includes(bad), false);
  }
  const det = adaptReport(value, identity('diff_result', 'diff'), { details: true });
  const d = det.report.findings[0].details[0];
  assert.equal(d.subject, HOSTILE_TOOL); // tool name allowed in details mode
  assert.equal(d.message.includes('[PATH]'), true);
  assert.equal(d.message.includes('[REDACTED]'), true);
});

test('policy: hostile tool/message redacted in details mode', () => {
  const value = {
    format: 'joons-mcp-policy-gate/result',
    schemaVersion: 1,
    verdict: 'FAIL',
    date: '2027-01-01',
    summary: { tools: 1, fail: 1, warn: 0, rules: ['tool_denied'] },
    findings: [{ rule: 'tool_denied', level: 'fail', tool: HOSTILE_TOOL, message: HOSTILE_MESSAGE }],
  };
  const def = adaptReport(value, identity('policy_check', 'policy-gate'), {});
  const defText = JSON.stringify(def.report);
  for (const bad of ['<script>', 'onload=', 'example-user', 'ghp_EXAMPLE']) {
    assert.equal(defText.includes(bad), false);
  }
  const det = adaptReport(value, identity('policy_check', 'policy-gate'), { details: true });
  const d = det.report.findings[0].details[0];
  assert.equal(d.message.includes('[PATH]'), true);
  assert.equal(d.message.includes('[REDACTED]'), true);
});

test('contract: hostile failure message redacted in details mode; PASS result text dropped', () => {
  const value = {
    format: 'joons-mcp-contract-test/report',
    schemaVersion: 1,
    verdict: 'FAIL',
    summary: { total: 1, passed: 0, failed: 1, skipped: 0, durationMs: 3 },
    results: [{
      id: 't1', tool: HOSTILE_TOOL, status: 'FAIL', reason: null,
      failures: [{ assertion: 'text.equals', expected: 'x', actual: HOSTILE_MESSAGE, message: HOSTILE_MESSAGE }],
    }],
  };
  const def = adaptReport(value, identity('contract_run', 'contract-runner'), {});
  const defText = JSON.stringify(def.report);
  for (const bad of ['<script>', 'onload=', 'example-user', 'ghp_EXAMPLE']) {
    assert.equal(defText.includes(bad), false);
  }
  const det = adaptReport(value, identity('contract_run', 'contract-runner'), { details: true });
  const d = det.report.findings[0].details[0];
  assert.equal(d.message.includes('[PATH]'), true);
  assert.equal(d.message.includes('[REDACTED]'), true);
});

test('mock: hostile scenario string redacted, only in details mode', () => {
  const value = {
    format: 'joons-mcp-mock-server/report',
    schemaVersion: 1,
    scenario: HOSTILE_MESSAGE,
    totals: { calls: 1, byOutcome: { result: 1 } },
    droppedCalls: 0,
  };
  const def = adaptReport(value, identity('mock_session', 'mock-server'), {});
  assert.equal('scenario' in def.report, false);
  const det = adaptReport(value, identity('mock_session', 'mock-server'), { details: true });
  assert.equal(det.report.scenario.includes('[PATH]'), true);
  assert.equal(det.report.scenario.includes('example-user'), false);
});

// ---------- prototype pollution ----------

test('mock byOutcome with __proto__ key never pollutes Object.prototype', () => {
  const value = JSON.parse(
    '{"format":"joons-mcp-mock-server/report","schemaVersion":1,"totals":{"calls":3,"byOutcome":{"result":2,"__proto__":1,"constructor":1}},"droppedCalls":0}'
  );
  const r = adaptReport(value, identity('mock_session', 'mock-server'), {});
  assert.equal(r.ok, true);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.deepEqual(r.report.counts.byOutcome, { result: 2, unknown: 2 });
});

test('report objects carrying __proto__/constructor keys adapt without pollution', () => {
  const value = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":{"x":1},"schemaVersion":1,"tool":{"name":"joons-mcp-probe","version":"0.1.0"},"status":"PASS","finishedAt":"2026-11-12T14:26:17.773Z","timings":{"totalMs":1},"tools":{"count":0},"findings":[],"failure":null}'
  );
  const r = adaptReport(value, identity('probe_report', 'probe'), {});
  assert.equal(r.ok, true);
  assert.equal(({}).polluted, undefined);
  assert.equal(r.report.status.value, 'PASS');
});

// ---------- unknown enum tokens become 'unknown' ----------

test('probe unknown finding id becomes code unknown', () => {
  const value = baseProbe({
    status: 'WARNING',
    findings: [{ id: 'MADE_UP_ID', severity: 'warning', message: 'x' }],
  });
  const r = adaptReport(value, identity('probe_report', 'probe'), {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.report.findings, [{ severity: 'warn', code: 'unknown', count: 1 }]);
  assert.equal(r.report.counts.findingsWarning, 1);
});

test('probe unknown status token becomes value unknown with warning level', () => {
  const r = adaptReport(baseProbe({ status: 'NOT_A_STATUS' }), identity('probe_report', 'probe'), {});
  assert.equal(r.ok, true);
  assert.equal(r.report.status.value, 'unknown');
  assert.equal(r.report.status.level, 'warning');
});

test('diff unknown risk token becomes unknown (warning), unknown kind becomes code unknown', () => {
  const value = {
    format: 'joons-mcp-diff/result',
    schemaVersion: 1,
    summary: { added: 0, removed: 0, changed: 1, unchanged: 0, breaking: 0, nonBreaking: 1, unknown: 0, risk: 'medium' },
    tools: [{ name: 'a', status: 'changed', changes: [{ kind: 'weird_kind', severity: 'NON_BREAKING', message: 'm' }] }],
  };
  const r = adaptReport(value, identity('diff_result', 'diff'), {});
  assert.equal(r.ok, true);
  assert.equal(r.report.status.value, 'unknown');
  assert.equal(r.report.status.level, 'warning');
  assert.deepEqual(r.report.findings, [{ severity: 'info', code: 'unknown', count: 1 }]);
});

test('policy unknown rule becomes code unknown; unknown verdict becomes unknown', () => {
  const value = {
    format: 'joons-mcp-policy-gate/result',
    schemaVersion: 1,
    verdict: 'MAYBE',
    date: '2027-01-01',
    summary: { tools: 1, fail: 1, warn: 0, rules: [] },
    findings: [{ rule: 'made_up_rule', level: 'fail', tool: 't', message: 'm' }],
  };
  const r = adaptReport(value, identity('policy_check', 'policy-gate'), {});
  assert.equal(r.ok, true);
  assert.equal(r.report.status.value, 'unknown');
  assert.equal(r.report.status.level, 'warning');
  assert.deepEqual(r.report.findings, [{ severity: 'fail', code: 'unknown', count: 1 }]);
});

test('contract unknown assertion root becomes code unknown', () => {
  const value = {
    format: 'joons-mcp-contract-test/report',
    schemaVersion: 1,
    verdict: 'FAIL',
    summary: { total: 1, passed: 0, failed: 1, skipped: 0, durationMs: 1 },
    results: [{
      id: 't', tool: 'x', status: 'FAIL', reason: null,
      failures: [{ assertion: 'error.message', expected: null, actual: null, message: 'boom' }],
    }],
  };
  const r = adaptReport(value, identity('contract_run', 'contract-runner'), {});
  assert.deepEqual(r.report.findings, [{ severity: 'fail', code: 'unknown', count: 1 }]);
});

test('contract assertion root is taken before the first slash or angle bracket', () => {
  const value = {
    format: 'joons-mcp-contract-test/report',
    schemaVersion: 1,
    verdict: 'FAIL',
    summary: { total: 2, passed: 0, failed: 2, skipped: 0, durationMs: 1 },
    results: [
      { id: 'a', status: 'FAIL', reason: null, failures: [{ assertion: 'fields/price.type' }] },
      { id: 'b', status: 'FAIL', reason: null, failures: [{ assertion: 'text.equals<case' }] },
    ],
  };
  const r = adaptReport(value, identity('contract_run', 'contract-runner'), {});
  assert.deepEqual(r.report.findings, [{ severity: 'fail', code: 'fields', count: 1 }, { severity: 'fail', code: 'text.equals', count: 1 }]);
});

test('contract FAIL result with reason and no failures counts as code reason', () => {
  const value = {
    format: 'joons-mcp-contract-test/report',
    schemaVersion: 1,
    verdict: 'FAIL',
    summary: { total: 1, passed: 0, failed: 1, skipped: 0, durationMs: 1 },
    results: [{ id: 't', tool: 'x', status: 'FAIL', reason: 'tool not listed', failures: [] }],
  };
  const r = adaptReport(value, identity('contract_run', 'contract-runner'), {});
  assert.deepEqual(r.report.findings, [{ severity: 'fail', code: 'reason', count: 1 }]);
});

// ---------- malformed types and missing fields, with pointer paths ----------

const MALFORMED = [
  ['probe status wrong type', baseProbe({ status: 42 }), 'probe_report', 'probe', '/status'],
  ['probe findings not an array', baseProbe({ findings: 'nope' }), 'probe_report', 'probe', '/findings'],
  ['probe finding not an object', baseProbe({ findings: [1] }), 'probe_report', 'probe', '/findings/0'],
  ['probe severity not a string', baseProbe({ findings: [{ id: 'TOOLS_EMPTY', severity: 3 }] }), 'probe_report', 'probe', '/findings/0/severity'],
  ['probe timings wrong type', baseProbe({ timings: 'fast' }), 'probe_report', 'probe', '/timings'],
  ['probe tools wrong type', baseProbe({ tools: 7 }), 'probe_report', 'probe', '/tools'],
  ['probe failure wrong type', baseProbe({ failure: 'boom' }), 'probe_report', 'probe', '/failure'],
  ['probe missing status', baseProbe({ status: undefined }), 'probe_report', 'probe', '/status'],
  ['diff missing summary', { format: 'joons-mcp-diff/result', schemaVersion: 1 }, 'diff_result', 'diff', '/summary'],
  ['diff summary added wrong type', {
    format: 'joons-mcp-diff/result', schemaVersion: 1,
    summary: { added: 'x', removed: 0, changed: 0, unchanged: 0, breaking: 0, nonBreaking: 0, unknown: 0, risk: 'none' },
    tools: [],
  }, 'diff_result', 'diff', '/summary/added'],
  ['diff tools not an array', {
    format: 'joons-mcp-diff/result', schemaVersion: 1,
    summary: { added: 0, removed: 0, changed: 0, unchanged: 0, breaking: 0, nonBreaking: 0, unknown: 0, risk: 'none' },
    tools: {},
  }, 'diff_result', 'diff', '/tools'],
  ['diff change severity unknown token', {
    format: 'joons-mcp-diff/result', schemaVersion: 1,
    summary: { added: 0, removed: 0, changed: 1, unchanged: 0, breaking: 1, nonBreaking: 0, unknown: 0, risk: 'high' },
    tools: [{ name: 'a', changes: [{ kind: 'tool_added', severity: 'HUGE' }] }],
  }, 'diff_result', 'diff', '/tools/0/changes/0/severity'],
  ['policy verdict missing', {
    format: 'joons-mcp-policy-gate/result', schemaVersion: 1, date: '2027-01-01',
    summary: { tools: 0, fail: 0, warn: 0, rules: [] }, findings: [],
  }, 'policy_check', 'policy-gate', '/verdict'],
  ['policy summary fail wrong type', {
    format: 'joons-mcp-policy-gate/result', schemaVersion: 1, verdict: 'PASS', date: '2027-01-01',
    summary: { tools: 0, fail: 'x', warn: 0, rules: [] }, findings: [],
  }, 'policy_check', 'policy-gate', '/summary/fail'],
  ['policy finding level invalid', {
    format: 'joons-mcp-policy-gate/result', schemaVersion: 1, verdict: 'FAIL', date: '2027-01-01',
    summary: { tools: 1, fail: 1, warn: 0, rules: [] },
    findings: [{ rule: 'tool_denied', level: 'fatal' }],
  }, 'policy_check', 'policy-gate', '/findings/0/level'],
  ['mock totals missing', { format: 'joons-mcp-mock-server/report', schemaVersion: 1 }, 'mock_session', 'mock-server', '/totals'],
  ['mock byOutcome value wrong type', {
    format: 'joons-mcp-mock-server/report', schemaVersion: 1,
    totals: { calls: 1, byOutcome: { result: 'x' } },
  }, 'mock_session', 'mock-server', '/totals/byOutcome/result'],
  ['contract summary total wrong type', {
    format: 'joons-mcp-contract-test/report', schemaVersion: 1, verdict: 'PASS',
    summary: { total: 'x', passed: 0, failed: 0, skipped: 0, durationMs: 0 }, results: [],
  }, 'contract_run', 'contract-runner', '/summary/total'],
  ['contract results missing', {
    format: 'joons-mcp-contract-test/report', schemaVersion: 1, verdict: 'PASS',
    summary: { total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 },
  }, 'contract_run', 'contract-runner', '/results'],
  ['contract result status invalid', {
    format: 'joons-mcp-contract-test/report', schemaVersion: 1, verdict: 'FAIL',
    summary: { total: 1, passed: 0, failed: 1, skipped: 0, durationMs: 0 },
    results: [{ id: 't', status: 'MAYBE', failures: [] }],
  }, 'contract_run', 'contract-runner', '/results/0/status'],
  ['validation ok wrong type', {
    format: 'joons-mcp-mock-server/validation', schemaVersion: 1, ok: 'yes', errors: [], warnings: [],
  }, 'validation', 'mock-server', '/ok'],
  ['validation errors not an array', {
    format: 'joons-mcp-mock-server/validation', schemaVersion: 1, ok: true, errors: {}, warnings: [],
  }, 'validation', 'mock-server', '/errors'],
];

for (const [title, value, reportType, product, expectedPointer] of MALFORMED) {
  test('malformed rejected with pointer: ' + title, () => {
    const r = adaptReport(value, identity(reportType, product), {});
    assert.deepEqual(r, { ok: false, kind: 'malformed_report', detail: expectedPointer });
    assert.equal(JSON.stringify(r).includes('boom'), false); // no values leak
  });
}

// ---------- inconsistent counts rejected ----------

test('policy inconsistent summary counts rejected at /summary', () => {
  const value = {
    format: 'joons-mcp-policy-gate/result', schemaVersion: 1, verdict: 'FAIL', date: '2027-01-01',
    summary: { tools: 1, fail: 2, warn: 0, rules: [] },
    findings: [{ rule: 'tool_denied', level: 'fail', tool: 't', message: 'm' }],
  };
  const r = adaptReport(value, identity('policy_check', 'policy-gate'), {});
  assert.deepEqual(r, { ok: false, kind: 'malformed_report', detail: '/summary' });
});

test('diff inconsistent breaking count rejected at /summary', () => {
  const value = {
    format: 'joons-mcp-diff/result', schemaVersion: 1,
    summary: { added: 0, removed: 1, changed: 0, unchanged: 0, breaking: 9, nonBreaking: 0, unknown: 0, risk: 'high' },
    tools: [{ name: 'a', changes: [{ kind: 'tool_removed', severity: 'BREAKING' }] }],
  };
  const r = adaptReport(value, identity('diff_result', 'diff'), {});
  assert.deepEqual(r, { ok: false, kind: 'malformed_report', detail: '/summary' });
});

test('contract summary total not equal to results length rejected at /summary', () => {
  const value = {
    format: 'joons-mcp-contract-test/report', schemaVersion: 1, verdict: 'PASS',
    summary: { total: 5, passed: 0, failed: 0, skipped: 0, durationMs: 0 },
    results: [],
  };
  const r = adaptReport(value, identity('contract_run', 'contract-runner'), {});
  assert.deepEqual(r, { ok: false, kind: 'malformed_report', detail: '/summary' });
});

test('contract failed count not equal to FAIL results rejected', () => {
  const value = {
    format: 'joons-mcp-contract-test/report', schemaVersion: 1, verdict: 'FAIL',
    summary: { total: 1, passed: 0, failed: 0, skipped: 0, durationMs: 0 },
    results: [{ id: 't', status: 'FAIL', reason: null, failures: [{ assertion: 'tool' }] }],
  };
  const r = adaptReport(value, identity('contract_run', 'contract-runner'), {});
  assert.deepEqual(r, { ok: false, kind: 'malformed_report', detail: '/summary' });
});

// ---------- details mode specifics ----------

test('details mode adds per-finding subject/message and default mode omits details', () => {
  const value = baseProbe({
    status: 'WARNING',
    findings: [{ id: 'TOOLS_EMPTY', severity: 'warning', message: 'No tools were returned.', tool: 'list_tools' }],
  });
  const def = adaptReport(value, identity('probe_report', 'probe'), {});
  assert.equal('details' in def.report.findings[0], false);
  const det = adaptReport(value, identity('probe_report', 'probe'), { details: true });
  assert.deepEqual(det.report.findings[0].details, [
    { subject: 'list_tools', message: 'No tools were returned.' },
  ]);
});

test('details strings are truncated to 200 chars with ellipsis', () => {
  const long = 'x '.repeat(250); // 500 chars, spaces keep it out of the token rule
  const value = baseProbe({
    status: 'WARNING',
    findings: [{ id: 'TOOLS_EMPTY', severity: 'warning', message: long }],
  });
  const det = adaptReport(value, identity('probe_report', 'probe'), { details: true });
  const message = det.report.findings[0].details[0].message;
  assert.equal(message.length, 203);
  assert.equal(message.endsWith('...'), true);
});

test('validation details mode exposes redacted messages as findings', () => {
  const value = {
    format: 'joons-mcp-policy-gate/policy-validation', schemaVersion: 1, ok: false,
    errors: [{ path: '/x', message: 'bad token ghp_EXAMPLE0123456789abcdefghijklmn here' }],
    warnings: [{ path: '/y', message: 'odd' }],
  };
  const det = adaptReport(value, identity('validation', 'policy-gate'), { details: true });
  assert.deepEqual(det.report.findings, [
    { severity: 'fail', code: 'validation_error', count: 1, details: [{ subject: null, message: 'bad token [REDACTED] here' }] },
    { severity: 'warn', code: 'validation_warning', count: 1, details: [{ subject: null, message: 'odd' }] },
  ]);
  const def = adaptReport(value, identity('validation', 'policy-gate'), {});
  assert.deepEqual(def.report.findings, []);
  assert.equal(JSON.stringify(def.report).includes('ghp_EXAMPLE'), false);
});

test('mock session findings stay empty even in details mode (never fabricate)', () => {
  const value = {
    format: 'joons-mcp-mock-server/report', schemaVersion: 1, scenario: 'default',
    totals: { calls: 2, byOutcome: { result: 2 } }, droppedCalls: 0,
  };
  const det = adaptReport(value, identity('mock_session', 'mock-server'), { details: true });
  assert.deepEqual(det.report.findings, []);
  assert.equal(det.report.status.level, 'info');
});

test('unsupported reportType in identity is a malformed result, not a crash', () => {
  const r = adaptReport({}, identity('nonsense', 'probe'), {});
  assert.deepEqual(r, { ok: false, kind: 'malformed_report', detail: '/reportType' });
});
