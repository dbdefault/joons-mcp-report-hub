import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { identifyReport } from '../src/input/identify.js';
import { parseJsonText } from '../src/input/read.js';

const REAL_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'real',
);

// Expected identity per folder + file name pattern.
const FOLDER_RULES = {
  probe: [
    [/\.json$/, { product: 'probe', reportType: 'probe_report', sourceFormat: '(none)' }],
  ],
  diff: [
    [/snapshot.*\.json$/, { ignored: true, detail: 'joons-mcp-diff/snapshot' }],
    [/\.json$/, { product: 'diff', reportType: 'diff_result', sourceFormat: 'joons-mcp-diff/result' }],
  ],
  'policy-gate': [
    [/^check.*\.json$/, { product: 'policy-gate', reportType: 'policy_check', sourceFormat: 'joons-mcp-policy-gate/result' }],
    [/^validate.*\.json$/, { product: 'policy-gate', reportType: 'validation', sourceFormat: 'joons-mcp-policy-gate/policy-validation' }],
  ],
  'mock-server': [
    [/^session.*\.json$/, { product: 'mock-server', reportType: 'mock_session', sourceFormat: 'joons-mcp-mock-server/report' }],
    [/^validate.*\.json$/, { product: 'mock-server', reportType: 'validation', sourceFormat: 'joons-mcp-mock-server/validation' }],
  ],
  'contract-runner': [
    [/^run.*\.json$/, { product: 'contract-runner', reportType: 'contract_run', sourceFormat: 'joons-mcp-contract-test/report' }],
    [/^validate.*\.json$/, { product: 'contract-runner', reportType: 'validation', sourceFormat: 'joons-mcp-contract-test/validation' }],
  ],
};

test('every real fixture identifies as its expected product/reportType', () => {
  const folders = fs.readdirSync(REAL_DIR);
  let count = 0;
  for (const folder of folders) {
    const rules = FOLDER_RULES[folder];
    assert.ok(rules, `no rules for fixture folder ${folder}`);
    for (const name of fs.readdirSync(path.join(REAL_DIR, folder)).sort()) {
      if (!name.endsWith('.json')) continue;
      const rule = rules.find(([re]) => re.test(name));
      assert.ok(rule, `no rule for ${folder}/${name}`);
      const expected = rule[1];
      const value = parseJsonText(
        fs.readFileSync(path.join(REAL_DIR, folder, name), 'utf8'),
      );
      const got = identifyReport(value);
      count += 1;
      if (expected.ignored) {
        assert.deepEqual(
          got,
          { ok: false, kind: 'ignored_input', detail: expected.detail },
          `${folder}/${name}`,
        );
      } else {
        assert.deepEqual(
          got,
          { ok: true, ...expected },
          `${folder}/${name}`,
        );
      }
    }
  }
  assert.equal(count, 41);
});

test('unknown hostile format string is reported as the fixed phrase only', () => {
  const hostile = 'joons-mcp-evil/<script>alert(1)</script>';
  const got = identifyReport({
    format: hostile,
    schemaVersion: 1,
    extra: 'x',
  });
  assert.deepEqual(got, {
    ok: false,
    kind: 'unknown_format',
    detail: 'unrecognized report format',
  });
  assert.ok(!got.detail.includes('<script>'));
});

test('valid JSON that matches nothing is unknown_format', () => {
  for (const value of [{}, { schemaVersion: 1 }, [], [1, 2], null, 'text', 42, true]) {
    assert.deepEqual(identifyReport(value), {
      ok: false,
      kind: 'unknown_format',
      detail: 'unrecognized report format',
    });
  }
});

test('non-string format key is unknown_format', () => {
  assert.equal(identifyReport({ format: 7 }).kind, 'unknown_format');
  assert.equal(
    identifyReport({ format: { toString: () => 'joons-mcp-diff/result' } }).kind,
    'unknown_format',
  );
});

test('diff snapshot is ignored_input, never an error verdict', () => {
  const got = identifyReport({
    format: 'joons-mcp-diff/snapshot',
    schemaVersion: 1,
    tools: [],
  });
  assert.deepEqual(got, {
    ok: false,
    kind: 'ignored_input',
    detail: 'joons-mcp-diff/snapshot',
  });
});

test('recognized format with schemaVersion other than 1 is unsupported_version', () => {
  assert.deepEqual(
    identifyReport({ format: 'joons-mcp-diff/result', schemaVersion: 2 }),
    { ok: false, kind: 'unsupported_version', detail: 'joons-mcp-diff/result 2' },
  );
  assert.deepEqual(
    identifyReport({ format: 'joons-mcp-contract-test/report', schemaVersion: 0 }),
    { ok: false, kind: 'unsupported_version', detail: 'joons-mcp-contract-test/report 0' },
  );
  // missing or non-number versions are reported as "unknown", never echoed
  assert.deepEqual(
    identifyReport({ format: 'joons-mcp-diff/result' }),
    { ok: false, kind: 'unsupported_version', detail: 'joons-mcp-diff/result unknown' },
  );
  const hostile = identifyReport({ format: 'joons-mcp-diff/result', schemaVersion: '<script>' });
  assert.equal(hostile.kind, 'unsupported_version');
  assert.equal(hostile.detail, 'joons-mcp-diff/result unknown');
});

test('probe detection requires all probe markers', () => {
  const base = {
    schemaVersion: 1,
    tool: { name: 'joons-mcp-probe', version: '0.1.0' },
    status: 'PASS',
    target: { transport: 'stdio' },
  };
  assert.deepEqual(identifyReport(base), {
    ok: true, product: 'probe', reportType: 'probe_report', sourceFormat: '(none)',
  });
  const noStatus = { ...base };
  delete noStatus.status;
  assert.equal(identifyReport(noStatus).kind, 'unknown_format');
  const noTarget = { ...base };
  delete noTarget.target;
  assert.equal(identifyReport(noTarget).kind, 'unknown_format');
  assert.equal(identifyReport({ ...base, schemaVersion: 2 }).kind, 'unknown_format');
  assert.equal(
    identifyReport({ ...base, tool: { name: 'joons-mcp-probe-evil' } }).kind,
    'unknown_format',
  );
  assert.equal(
    identifyReport({ ...base, format: 'joons-mcp-probe' }).kind,
    'unknown_format',
  );
});

test('probe with inherited tool.name does not identify', () => {
  const proto = { tool: { name: 'joons-mcp-probe' } };
  const value = Object.create(proto);
  value.schemaVersion = 1;
  value.status = 'PASS';
  value.target = {};
  assert.equal(identifyReport(value).kind, 'unknown_format');
});
