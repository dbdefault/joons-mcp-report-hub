// buildSummary: dedupe, deterministic ordering, per-product aggregation, overall status.

import { PRODUCT_ORDER, LEVEL_RANK, sortedObject } from './normalize.js';

const TOOL_NAME = 'joons-mcp-report-hub';
const TOOL_VERSION = '0.1.0';

const PRODUCT_INDEX = new Map(PRODUCT_ORDER.map((p, i) => [p, i]));

function compareReports(a, b) {
  const pa = PRODUCT_INDEX.get(a.product) ?? PRODUCT_ORDER.length;
  const pb = PRODUCT_INDEX.get(b.product) ?? PRODUCT_ORDER.length;
  if (pa !== pb) return pa - pb;
  if (a.reportType < b.reportType) return -1;
  if (a.reportType > b.reportType) return 1;
  const ta = a.timestamp;
  const tb = b.timestamp;
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    if (ta < tb) return -1;
    if (ta > tb) return 1;
  }
  if (a.source.sha256 < b.source.sha256) return -1;
  if (a.source.sha256 > b.source.sha256) return 1;
  return 0;
}

function mergeCounts(target, counts) {
  for (const key of Object.keys(counts)) {
    const val = counts[key];
    if (key === 'byOutcome' && val !== null && typeof val === 'object') {
      const merged = target.byOutcome && typeof target.byOutcome === 'object' ? target.byOutcome : {};
      for (const outcome of Object.keys(val)) {
        merged[outcome] = (merged[outcome] ?? 0) + val[outcome];
      }
      target.byOutcome = merged;
    } else if (typeof val === 'number') {
      target[key] = (typeof target[key] === 'number' ? target[key] : 0) + val;
    } else if (!Object.hasOwn(target, key)) {
      target[key] = null;
    }
  }
}

function finalizeCounts(counts) {
  const out = {};
  for (const key of Object.keys(counts)) {
    if (key === 'byOutcome' && counts[key] !== null && typeof counts[key] === 'object') {
      out[key] = sortedObject(Object.entries(counts[key]));
    } else {
      out[key] = counts[key];
    }
  }
  return out;
}

function problemSource(problem) {
  return (problem && problem.source) || { label: 'report-?', sha256: '' };
}

function compareProblems(a, b) {
  if (a.kind < b.kind) return -1;
  if (a.kind > b.kind) return 1;
  const sa = problemSource(a).sha256;
  const sb = problemSource(b).sha256;
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  const da = a.detail ?? '';
  const db = b.detail ?? '';
  if (da < db) return -1;
  if (da > db) return 1;
  return 0;
}

// entries: normalized reports in collected order (adaptReport results with ok: true).
// problems: input-layer problems [{kind, source: {label, sha256}, detail}].
// options: {details, showFileNames, stable, duplicates: 'keep-first'|'error'}
export function buildSummary(entries, problems, options = {}) {
  const opts = {
    details: options.details === true,
    showFileNames: options.showFileNames === true,
    stable: options.stable === true,
    duplicates: options.duplicates === 'error' ? 'error' : 'keep-first',
  };

  const allProblems = [...(problems ?? [])];
  const accepted = [];
  const seenHashes = new Set();

  for (const report of entries ?? []) {
    const hash = report.source.sha256;
    if (seenHashes.has(hash)) {
      allProblems.push({
        kind: 'duplicate',
        source: { label: report.source.label, sha256: hash },
        detail: 'identical content to an earlier input',
      });
      continue;
    }
    seenHashes.add(hash);
    accepted.push(report);
  }

  accepted.sort(compareReports);
  const reports = accepted.map((report, i) => ({ ...report, id: 'r' + (i + 1) }));

  // Per-product aggregation.
  const products = {};
  for (const product of PRODUCT_ORDER) {
    products[product] = { reports: 0, level: 'none', worstStatus: null, counts: {} };
  }
  let testPassed = 0;
  let testFailed = 0;

  for (const report of reports) {
    const bucket = products[report.product];
    if (!bucket) continue;
    bucket.reports += 1;
    mergeCounts(bucket.counts, report.counts ?? {});
    if (LEVEL_RANK[report.status.level] > LEVEL_RANK[bucket.level]) {
      bucket.level = report.status.level;
      bucket.worstStatus = report.status.value;
    }
    if (report.reportType === 'contract_run') {
      testPassed += report.counts?.passed ?? 0;
      testFailed += report.counts?.failed ?? 0;
    }
  }

  for (const product of PRODUCT_ORDER) {
    products[product].counts = finalizeCounts(products[product].counts);
  }

  // Totals.
  let duplicates = 0;
  let ignored = 0;
  let rejected = 0;
  let inputProblem = false;
  for (const problem of allProblems) {
    if (problem.kind === 'ignored_input') {
      ignored += 1;
    } else if (problem.kind === 'duplicate') {
      if (opts.duplicates === 'error') {
        rejected += 1;
        inputProblem = true;
      } else {
        duplicates += 1;
      }
    } else {
      rejected += 1;
      inputProblem = true;
    }
  }

  const testTotal = testPassed + testFailed;

  // Overall rule.
  let status;
  const reasons = [];
  if (reports.some((r) => r.status.level === 'failure')) {
    status = 'FAIL';
    reasons.push('failing_report');
  } else {
    const hasWarning = reports.some((r) => r.status.level === 'warning');
    if (hasWarning) reasons.push('warning_report');
    if (inputProblem) reasons.push('input_problem');
    if (hasWarning || inputProblem) {
      status = 'WARN';
    } else if (!reports.some((r) => r.status.level === 'ok')) {
      status = 'NO_DATA';
      reasons.push('no_verdict_reports');
    } else {
      status = 'PASS';
    }
  }

  allProblems.sort(compareProblems);

  return {
    format: 'joons-mcp-report-hub/summary',
    schemaVersion: 1,
    generatedAt: opts.stable ? null : new Date().toISOString(),
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    mode: {
      details: opts.details,
      showFileNames: opts.showFileNames,
      stable: opts.stable,
      duplicates: opts.duplicates,
    },
    overall: { status, reasons },
    totals: {
      files: reports.length + allProblems.length,
      reports: reports.length,
      duplicates,
      ignored,
      rejected,
    },
    products,
    testSuccessRate: {
      passed: testPassed,
      failed: testFailed,
      percent: testTotal === 0 ? null : Math.floor((100 * testPassed) / testTotal),
    },
    reports,
    problems: allProblems,
  };
}
