// Terminal rendering: plain text, no ANSI. Same numbers and statuses as the
// JSON reference. Every status is shown with its kind label
// ("Server health", "Change risk", "Policy compliance", "Test results",
// "Mock recording (not a test result)", "Input validation").
// Dynamic text is control-stripped (defense in depth; aggregation already
// redacts) so no ANSI or bidi can reach the terminal.

import { stripControls } from '../util/object.js';

const KIND_LABELS = Object.freeze({
  health: 'Server health',
  change_risk: 'Change risk',
  policy: 'Policy compliance',
  tests: 'Test results',
  recording: 'Mock recording (not a test result)',
  validation: 'Input validation',
});

const PRODUCT_ORDER = ['probe', 'diff', 'policy-gate', 'mock-server', 'contract-runner'];

const LEVEL_RANK = Object.freeze({ none: 0, info: 1, ok: 2, warning: 3, failure: 4 });

const FINDING_LIMIT = 20;

function t(text) {
  return stripControls(String(text), { keepNewlines: true });
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function kindLabel(kind) {
  return Object.prototype.hasOwnProperty.call(KIND_LABELS, kind) ? KIND_LABELS[kind] : t(kind);
}

function reportLevel(report) {
  const status = asObject(report && report.status);
  const rank = LEVEL_RANK[status.level];
  return rank === undefined ? 0 : rank;
}

function worstReport(reports) {
  let worst = null;
  for (const report of reports) {
    if (!worst || reportLevel(report) > reportLevel(worst)) worst = report;
  }
  return worst;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function sortedFindings(reports) {
  const collected = [];
  reports.forEach((report, reportIndex) => {
    asArray(report && report.findings).forEach((finding, findingIndex) => {
      collected.push({ report, finding, reportIndex, findingIndex });
    });
  });
  const severityRank = { fail: 0, warn: 1, info: 2 };
  collected.sort((a, b) => {
    const sa = severityRank[a.finding && a.finding.severity] ?? 3;
    const sb = severityRank[b.finding && b.finding.severity] ?? 3;
    if (sa !== sb) return sa - sb;
    if (a.reportIndex !== b.reportIndex) return a.reportIndex - b.reportIndex;
    return a.findingIndex - b.findingIndex;
  });
  return collected;
}

export function renderSummaryTerminal(summary) {
  const s = asObject(summary);
  const overall = asObject(s.overall);
  const totals = asObject(s.totals);
  const reports = asArray(s.reports).filter((r) => r && typeof r === 'object');
  const products = asObject(s.products);
  const statusText = typeof overall.status === 'string' ? t(overall.status) : 'NO_DATA';

  const out = [];
  out.push(`MCP Report Hub: ${statusText}`);
  out.push(`overall: ${statusText}`);

  const reasons = asArray(overall.reasons).map((r) => t(r));
  out.push(`Overall reasons: ${reasons.length > 0 ? reasons.join(', ') : 'none'}`);

  const files = Number.isFinite(totals.files) ? totals.files : 0;
  const reportCount = Number.isFinite(totals.reports) ? totals.reports : reports.length;
  const duplicates = Number.isFinite(totals.duplicates) ? totals.duplicates : 0;
  const ignored = Number.isFinite(totals.ignored) ? totals.ignored : 0;
  const rejected = Number.isFinite(totals.rejected) ? totals.rejected : 0;
  out.push(`reports: ${reportCount}`);
  out.push(
    `Counts: ${plural(files, 'file')}, ${plural(reportCount, 'report')}, ` +
      `${plural(duplicates, 'duplicate')}, ${plural(ignored, 'ignored')}, ${plural(rejected, 'rejected')}`
  );

  const rate = asObject(s.testSuccessRate);
  if (Number.isInteger(rate.percent)) {
    out.push(`Test success rate: ${rate.percent}% (${rate.passed} passed, ${rate.failed} failed)`);
  } else {
    out.push('Test success rate: not available');
  }

  out.push('Products:');
  for (const product of PRODUCT_ORDER) {
    const productReports = reports.filter((r) => r.product === product);
    const entry = asObject(products[product]);
    if (productReports.length === 0) {
      out.push(`  ${t(product)}: no reports`);
      continue;
    }
    const worst = worstReport(productReports);
    const status = asObject(worst.status);
    const value = typeof status.value === 'string' ? t(status.value) : 'unknown';
    const level = typeof status.level === 'string' ? t(status.level) : 'none';
    out.push(
      `  ${t(product)}: ${value} (${kindLabel(status.kind)}) - ` +
        `${plural(Number.isFinite(entry.reports) ? entry.reports : productReports.length, 'report')} - level ${level}`
    );
  }

  const findings = sortedFindings(reports);
  out.push(`Findings (up to ${FINDING_LIMIT}):`);
  if (findings.length === 0) {
    out.push('  none');
  } else {
    for (const item of findings.slice(0, FINDING_LIMIT)) {
      const severity = t(item.finding.severity);
      const code = t(item.finding.code);
      const count = Number.isFinite(item.finding.count) ? item.finding.count : 0;
      out.push(`  [${severity}] ${t(item.report.product)} ${t(item.report.id)} ${code} x${count}`);
    }
  }

  const problems = asArray(s.problems);
  out.push('Problems:');
  if (problems.length === 0) {
    out.push('  none');
  } else {
    for (const problem of problems) {
      const p = asObject(problem);
      const source = asObject(p.source);
      const label = typeof source.label === 'string' ? t(source.label) : 'report-?';
      const detail = typeof p.detail === 'string' ? t(p.detail) : '';
      out.push(`  - ${t(p.kind)} (${label}): ${detail}`);
    }
  }

  return out.join('\n') + '\n';
}
