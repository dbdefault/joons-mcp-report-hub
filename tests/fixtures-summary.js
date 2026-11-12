// Hand-made Summary fixtures for the RENDER test suites.
// Not a test file: helpers only. All values are fictional.

export const PAYLOADS = {
  script: '<script>alert(1)</script>',
  img: '"><img src=x onerror=alert(1)>',
  closeScript: '</script>',
  cdata: ']]>',
  jsUrl: 'javascript:alert(1)',
  bidi: 'spoofed-RLI\u202Ename',
  ansi: '\u001B[31mred\u001B[0m',
  long: 'A'.repeat(10000) + '<script>',
};

export function baseReport(overrides = {}) {
  return {
    id: 'r1',
    source: { label: 'report-1', sha256: 'a1b2c3d4e5f6', fileName: null },
    product: 'probe',
    reportType: 'probe_report',
    sourceFormat: '(none)',
    schemaVersion: 1,
    productVersion: '0.1.0',
    status: { kind: 'health', value: 'PASS', level: 'ok' },
    timestamp: '2026-11-12T14:26:17.773Z',
    durationMs: 1030,
    counts: {},
    findings: [],
    notAvailable: [],
    ...overrides,
  };
}

const PRODUCT_IDS = ['probe', 'diff', 'policy-gate', 'mock-server', 'contract-runner'];

export function productsMap(entries) {
  const products = {};
  for (const id of PRODUCT_IDS) {
    products[id] = entries[id]
      ? { reports: 0, level: 'none', worstStatus: null, counts: {}, ...entries[id] }
      : { reports: 0, level: 'none', worstStatus: null, counts: {} };
  }
  return products;
}

export function minimalSummary({
  overall = { status: 'PASS', reasons: [] },
  products = productsMap({}),
  reports = [],
  problems = [],
  totals = null,
  testSuccessRate = { passed: 0, failed: 0, percent: null },
  generatedAt = null,
  mode = { details: false, showFileNames: false, stable: false, duplicates: 'keep-first' },
} = {}) {
  return {
    format: 'joons-mcp-report-hub/summary',
    schemaVersion: 1,
    generatedAt,
    tool: { name: 'joons-mcp-report-hub', version: '0.1.0' },
    mode,
    overall,
    totals: totals || {
      files: reports.length + problems.length,
      reports: reports.length,
      duplicates: 0,
      ignored: 0,
      rejected: 0,
    },
    products,
    testSuccessRate,
    reports,
    problems,
  };
}

export function richSummary() {
  const r1 = baseReport({
    id: 'r1',
    source: { label: 'report-1', sha256: 'a1b2c3d4e5f6', fileName: null },
    counts: { tools: 5, findingsFail: 0, findingsWarning: 1, findingsInfo: 0 },
    findings: [{ severity: 'warn', code: 'TOOL_DESCRIPTION_MISSING', count: 2 }],
  });
  const r2 = baseReport({
    id: 'r2',
    source: { label: 'report-2', sha256: 'b2c3d4e5f607', fileName: null },
    product: 'diff',
    reportType: 'diff_result',
    sourceFormat: 'joons-mcp-diff/result',
    productVersion: '0.1.0',
    status: { kind: 'change_risk', value: 'high', level: 'failure' },
    timestamp: null,
    durationMs: null,
    counts: { added: 1, removed: 0, changed: 2, unchanged: 4, breaking: 1, nonBreaking: 1, unknown: 0 },
    findings: [
      { severity: 'fail', code: 'tool_removed', count: 1 },
      { severity: 'info', code: 'property_added', count: 1 },
    ],
    notAvailable: ['timestamp', 'durationMs'],
  });
  const r3 = baseReport({
    id: 'r3',
    source: { label: 'report-3', sha256: 'c3d4e5f60718', fileName: null },
    product: 'policy-gate',
    reportType: 'policy_check',
    sourceFormat: 'joons-mcp-policy-gate/result',
    status: { kind: 'policy', value: 'FAIL', level: 'failure' },
    timestamp: '2026-11-12',
    durationMs: null,
    counts: { tools: 5, fail: 2, warn: 1 },
    findings: [
      { severity: 'fail', code: 'tool_denied', count: 2 },
      { severity: 'warn', code: 'description_missing', count: 1 },
    ],
    notAvailable: ['durationMs'],
  });
  const r4 = baseReport({
    id: 'r4',
    source: { label: 'report-4', sha256: 'd4e5f6071829', fileName: null },
    product: 'mock-server',
    reportType: 'mock_session',
    sourceFormat: 'joons-mcp-mock-server/report',
    status: { kind: 'recording', value: 'RECORDED', level: 'info' },
    durationMs: null,
    counts: { calls: 42, droppedCalls: 0, byOutcome: { result: 40, is_error: 2 } },
    notAvailable: ['durationMs'],
  });
  const r5 = baseReport({
    id: 'r5',
    source: { label: 'report-5', sha256: 'e5f60718293a', fileName: null },
    product: 'contract-runner',
    reportType: 'contract_run',
    sourceFormat: 'joons-mcp-contract-test/report',
    status: { kind: 'tests', value: 'FAIL', level: 'failure' },
    durationMs: 2100,
    counts: { total: 5, passed: 4, failed: 1, skipped: 0 },
    findings: [
      {
        severity: 'fail',
        code: 'text.equals',
        count: 1,
        details: [{ subject: 'search-boots', message: 'text mismatch' }],
      },
    ],
  });
  const r6 = baseReport({
    id: 'r6',
    source: { label: 'report-6', sha256: 'f60718293a4b', fileName: null },
    product: 'policy-gate',
    reportType: 'validation',
    sourceFormat: 'joons-mcp-policy-gate/policy-validation',
    status: { kind: 'validation', value: 'INVALID', level: 'failure' },
    timestamp: '2026-11-12T15:00:00.000Z',
    durationMs: null,
    counts: { errors: 1, warnings: 0 },
  });
  return minimalSummary({
    overall: { status: 'FAIL', reasons: ['failing_report', 'input_problem'] },
    products: productsMap({
      probe: { reports: 1, level: 'ok', worstStatus: 'PASS', counts: { tools: 5, findingsFail: 0, findingsWarning: 1, findingsInfo: 0 } },
      diff: { reports: 1, level: 'failure', worstStatus: 'high', counts: { added: 1, removed: 0, changed: 2, unchanged: 4, breaking: 1, nonBreaking: 1, unknown: 0 } },
      'policy-gate': { reports: 2, level: 'failure', worstStatus: 'FAIL', counts: { tools: 5, fail: 2, warn: 1, errors: 1, warnings: 0 } },
      'mock-server': { reports: 1, level: 'info', worstStatus: 'RECORDED', counts: { calls: 42, droppedCalls: 0, byOutcome: { result: 40, is_error: 2 } } },
      'contract-runner': { reports: 1, level: 'failure', worstStatus: 'FAIL', counts: { total: 5, passed: 4, failed: 1, skipped: 0 } },
    }),
    reports: [r1, r2, r3, r4, r5, r6],
    problems: [
      { kind: 'invalid_json', source: { label: 'report-9', sha256: 'ff00ff00ff00' }, detail: 'line 3 column 5' },
    ],
    totals: { files: 9, reports: 6, duplicates: 1, ignored: 1, rejected: 1 },
    testSuccessRate: { passed: 4, failed: 1, percent: 80 },
    generatedAt: '2026-11-12T14:26:17.773Z',
    mode: { details: true, showFileNames: false, stable: false, duplicates: 'keep-first' },
  });
}

export function passSummary() {
  const reports = [
    baseReport({
      id: 'r1',
      source: { label: 'report-1', sha256: 'a1b2c3d4e5f6', fileName: null },
      counts: { tools: 3, findingsFail: 0, findingsWarning: 0, findingsInfo: 0 },
    }),
    baseReport({
      id: 'r2',
      source: { label: 'report-2', sha256: 'b2c3d4e5f607', fileName: null },
      product: 'diff',
      reportType: 'diff_result',
      sourceFormat: 'joons-mcp-diff/result',
      status: { kind: 'change_risk', value: 'none', level: 'ok' },
      timestamp: null,
      durationMs: null,
      counts: { added: 0, removed: 0, changed: 0, unchanged: 4, breaking: 0, nonBreaking: 0, unknown: 0 },
      notAvailable: ['timestamp', 'durationMs'],
    }),
    baseReport({
      id: 'r3',
      source: { label: 'report-3', sha256: 'c3d4e5f60718', fileName: null },
      product: 'policy-gate',
      reportType: 'policy_check',
      sourceFormat: 'joons-mcp-policy-gate/result',
      status: { kind: 'policy', value: 'PASS', level: 'ok' },
      timestamp: '2026-11-12',
      durationMs: null,
      counts: { tools: 3, fail: 0, warn: 0 },
      notAvailable: ['durationMs'],
    }),
    baseReport({
      id: 'r4',
      source: { label: 'report-4', sha256: 'd4e5f6071829', fileName: null },
      product: 'mock-server',
      reportType: 'mock_session',
      sourceFormat: 'joons-mcp-mock-server/report',
      status: { kind: 'recording', value: 'RECORDED', level: 'info' },
      durationMs: null,
      counts: { calls: 7, droppedCalls: 0, byOutcome: { result: 7 } },
      notAvailable: ['durationMs'],
    }),
    baseReport({
      id: 'r5',
      source: { label: 'report-5', sha256: 'e5f60718293a', fileName: null },
      product: 'contract-runner',
      reportType: 'contract_run',
      sourceFormat: 'joons-mcp-contract-test/report',
      status: { kind: 'tests', value: 'PASS', level: 'ok' },
      durationMs: 900,
      counts: { total: 3, passed: 3, failed: 0, skipped: 0 },
    }),
  ];
  return minimalSummary({
    overall: { status: 'PASS', reasons: [] },
    products: productsMap({
      probe: { reports: 1, level: 'ok', worstStatus: 'PASS', counts: { tools: 3 } },
      diff: { reports: 1, level: 'ok', worstStatus: 'none', counts: { unchanged: 4 } },
      'policy-gate': { reports: 1, level: 'ok', worstStatus: 'PASS', counts: { tools: 3 } },
      'mock-server': { reports: 1, level: 'info', worstStatus: 'RECORDED', counts: { calls: 7 } },
      'contract-runner': { reports: 1, level: 'ok', worstStatus: 'PASS', counts: { total: 3, passed: 3, failed: 0, skipped: 0 } },
    }),
    reports,
    problems: [
      { kind: 'ignored_input', source: { label: 'report-6', sha256: 'f60718293a4b' }, detail: 'joons-mcp-diff/snapshot' },
    ],
    totals: { files: 6, reports: 5, duplicates: 0, ignored: 1, rejected: 0 },
    testSuccessRate: { passed: 3, failed: 0, percent: 100 },
    generatedAt: '2026-11-12T10:00:00.000Z',
  });
}

export function warnSummary() {
  const reports = [
    baseReport({
      id: 'r1',
      source: { label: 'report-1', sha256: 'a1b2c3d4e5f6', fileName: null },
      status: { kind: 'health', value: 'WARNING', level: 'warning' },
      counts: { tools: 2, findingsFail: 0, findingsWarning: 1, findingsInfo: 0 },
      findings: [{ severity: 'warn', code: 'SCHEMA_PAGE_LIMIT', count: 1 }],
    }),
    baseReport({
      id: 'r2',
      source: { label: 'report-2', sha256: 'b2c3d4e5f607', fileName: null },
      product: 'diff',
      reportType: 'diff_result',
      sourceFormat: 'joons-mcp-diff/result',
      status: { kind: 'change_risk', value: 'low', level: 'ok' },
      timestamp: null,
      durationMs: null,
      counts: { added: 0, removed: 0, changed: 1, unchanged: 3, breaking: 0, nonBreaking: 1, unknown: 0 },
      notAvailable: ['timestamp', 'durationMs'],
    }),
    baseReport({
      id: 'r3',
      source: { label: 'report-3', sha256: 'c3d4e5f60718', fileName: null },
      product: 'policy-gate',
      reportType: 'policy_check',
      sourceFormat: 'joons-mcp-policy-gate/result',
      status: { kind: 'policy', value: 'WARN', level: 'warning' },
      timestamp: '2026-11-12',
      durationMs: null,
      counts: { tools: 2, fail: 0, warn: 1 },
      findings: [{ severity: 'warn', code: 'description_too_short', count: 1 }],
      notAvailable: ['durationMs'],
    }),
    baseReport({
      id: 'r4',
      source: { label: 'report-4', sha256: 'd4e5f6071829', fileName: null },
      product: 'mock-server',
      reportType: 'mock_session',
      sourceFormat: 'joons-mcp-mock-server/report',
      status: { kind: 'recording', value: 'RECORDED', level: 'info' },
      durationMs: null,
      counts: { calls: 0, droppedCalls: 0, byOutcome: {} },
      notAvailable: ['durationMs'],
    }),
    baseReport({
      id: 'r5',
      source: { label: 'report-5', sha256: 'e5f60718293a', fileName: null },
      product: 'contract-runner',
      reportType: 'contract_run',
      sourceFormat: 'joons-mcp-contract-test/report',
      status: { kind: 'tests', value: 'PASS', level: 'ok' },
      durationMs: 500,
      counts: { total: 2, passed: 1, failed: 0, skipped: 1 },
    }),
  ];
  return minimalSummary({
    overall: { status: 'WARN', reasons: ['warning_report', 'input_problem'] },
    products: productsMap({
      probe: { reports: 1, level: 'warning', worstStatus: 'WARNING', counts: { tools: 2 } },
      diff: { reports: 1, level: 'ok', worstStatus: 'low', counts: { changed: 1 } },
      'policy-gate': { reports: 1, level: 'warning', worstStatus: 'WARN', counts: { tools: 2, warn: 1 } },
      'mock-server': { reports: 1, level: 'info', worstStatus: 'RECORDED', counts: { calls: 0 } },
      'contract-runner': { reports: 1, level: 'ok', worstStatus: 'PASS', counts: { total: 2, passed: 1, failed: 0, skipped: 1 } },
    }),
    reports,
    problems: [
      { kind: 'unsupported_version', source: { label: 'report-7', sha256: 'ff00ff00ff00' }, detail: 'joons-mcp-diff/result schemaVersion 2' },
    ],
    totals: { files: 7, reports: 5, duplicates: 0, ignored: 1, rejected: 1 },
    testSuccessRate: { passed: 1, failed: 0, percent: 100 },
    generatedAt: '2026-11-12T09:30:00.000Z',
  });
}

export function noDataSummary() {
  const r1 = baseReport({
    id: 'r1',
    source: { label: 'report-1', sha256: 'd4e5f6071829', fileName: null },
    product: 'mock-server',
    reportType: 'mock_session',
    sourceFormat: 'joons-mcp-mock-server/report',
    status: { kind: 'recording', value: 'RECORDED', level: 'info' },
    durationMs: null,
    counts: { calls: 3, droppedCalls: 0, byOutcome: { result: 3 } },
    notAvailable: ['durationMs'],
  });
  return minimalSummary({
    overall: { status: 'NO_DATA', reasons: ['no_verdict_reports'] },
    products: productsMap({
      'mock-server': { reports: 1, level: 'info', worstStatus: 'RECORDED', counts: { calls: 3 } },
    }),
    reports: [r1],
    problems: [
      { kind: 'ignored_input', source: { label: 'report-2', sha256: 'f60718293a4b' }, detail: 'joons-mcp-diff/snapshot' },
    ],
    totals: { files: 2, reports: 1, duplicates: 0, ignored: 1, rejected: 0 },
    testSuccessRate: { passed: 0, failed: 0, percent: null },
    generatedAt: '2026-11-12T08:00:00.000Z',
  });
}

export function emptySummary() {
  return minimalSummary({
    overall: { status: 'NO_DATA', reasons: ['no_verdict_reports', 'input_problem'] },
    products: productsMap({}),
    reports: [],
    problems: [
      { kind: 'unknown_format', source: { label: 'report-1', sha256: '0f0f0f0f0f0f' }, detail: 'unknown format' },
    ],
    totals: { files: 1, reports: 0, duplicates: 0, ignored: 0, rejected: 1 },
    testSuccessRate: { passed: 0, failed: 0, percent: null },
    generatedAt: null,
  });
}

export function hostileSummary() {
  const { script, img, closeScript, cdata, jsUrl, bidi, ansi, long } = PAYLOADS;
  const r1 = baseReport({
    id: 'r1',
    source: { label: 'report-1', sha256: 'a1b2c3d4e5f6', fileName: 'hostile-<script>.json' },
    product: 'contract-runner',
    reportType: 'contract_run',
    sourceFormat: 'joons-mcp-contract-test/report',
    status: { kind: 'tests', value: 'FAIL', level: 'failure' },
    durationMs: 100,
    counts: { total: 2, passed: 1, failed: 1, skipped: 0 },
    findings: [
      {
        severity: 'fail',
        code: 'text.equals',
        count: 4,
        details: [
          { subject: script, message: img },
          { subject: closeScript, message: cdata },
          { subject: jsUrl, message: bidi },
          { subject: ansi, message: long },
        ],
      },
    ],
  });
  return minimalSummary({
    overall: { status: 'FAIL', reasons: ['failing_report'] },
    products: productsMap({
      'contract-runner': { reports: 1, level: 'failure', worstStatus: 'FAIL', counts: { total: 2, passed: 1, failed: 1, skipped: 0 } },
    }),
    reports: [r1],
    problems: [
      { kind: 'malformed_report', source: { label: 'report-2', sha256: 'ff00ff00ff00' }, detail: script },
      { kind: 'duplicate', source: { label: 'report-3', sha256: '0e0e0e0e0e0e' }, detail: `${ansi} ${bidi}` },
    ],
    totals: { files: 2, reports: 1, duplicates: 0, ignored: 0, rejected: 1 },
    testSuccessRate: { passed: 1, failed: 1, percent: 50 },
    generatedAt: null,
    mode: { details: true, showFileNames: true, stable: false, duplicates: 'keep-first' },
  });
}

export function manyFindingsSummary() {
  const findings = [];
  for (let i = 0; i < 25; i += 1) {
    findings.push({
      severity: i % 3 === 0 ? 'fail' : i % 3 === 1 ? 'warn' : 'info',
      code: `CODE_${i}`,
      count: 1,
    });
  }
  const r1 = baseReport({
    id: 'r1',
    source: { label: 'report-1', sha256: 'a1b2c3d4e5f6', fileName: null },
    status: { kind: 'health', value: 'FAIL', level: 'failure' },
    counts: { tools: 1, findingsFail: 9, findingsWarning: 8, findingsInfo: 8 },
    findings,
  });
  return minimalSummary({
    overall: { status: 'FAIL', reasons: ['failing_report'] },
    products: productsMap({
      probe: { reports: 1, level: 'failure', worstStatus: 'FAIL', counts: { tools: 1 } },
    }),
    reports: [r1],
    totals: { files: 1, reports: 1, duplicates: 0, ignored: 0, rejected: 0 },
    testSuccessRate: { passed: 0, failed: 0, percent: null },
    generatedAt: '2026-11-12T07:00:00.000Z',
  });
}

export function validationOnlySummary() {
  const r1 = baseReport({
    id: 'r1',
    source: { label: 'report-1', sha256: 'c3d4e5f60718', fileName: null },
    product: 'policy-gate',
    reportType: 'validation',
    sourceFormat: 'joons-mcp-policy-gate/policy-validation',
    status: { kind: 'validation', value: 'INVALID', level: 'failure' },
    timestamp: '2026-11-12T12:00:00.000Z',
    durationMs: null,
    counts: { errors: 2, warnings: 1 },
  });
  return minimalSummary({
    overall: { status: 'FAIL', reasons: ['failing_report'] },
    products: productsMap({
      'policy-gate': { reports: 1, level: 'failure', worstStatus: 'INVALID', counts: { errors: 2, warnings: 1 } },
    }),
    reports: [r1],
    totals: { files: 1, reports: 1, duplicates: 0, ignored: 0, rejected: 0 },
    testSuccessRate: { passed: 0, failed: 0, percent: null },
    generatedAt: '2026-11-12T12:00:00.000Z',
  });
}

export function contractRunReport({ id, passed, failed, skipped = 0 }) {
  return baseReport({
    id,
    source: { label: `report-${id.slice(1)}`, sha256: 'e5f60718293a', fileName: null },
    product: 'contract-runner',
    reportType: 'contract_run',
    sourceFormat: 'joons-mcp-contract-test/report',
    status: { kind: 'tests', value: failed > 0 ? 'FAIL' : 'PASS', level: failed > 0 ? 'failure' : 'ok' },
    durationMs: 800,
    counts: { total: passed + failed + skipped, passed, failed, skipped },
  });
}
