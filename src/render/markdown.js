// Markdown rendering. Same numbers and statuses as the JSON reference.
// All dynamic text goes through escapeMarkdown; details-mode free text is also
// control-stripped (aggregation already redacts it; this is defense in depth).

import { escapeMarkdown } from '../security/escape.js';
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

export const MARKDOWN_FOOTER =
  'Generated from JSON reports only; no MCP server was contacted.';

function em(text) {
  return escapeMarkdown(stripControls(String(text), { keepNewlines: true }))
    .replace(/&lt;/g, '\\<').replace(/&gt;/g, '\\>')
    .replace(/[-()]/g, (ch) => `\\${ch}`);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function kindLabel(kind) {
  return Object.prototype.hasOwnProperty.call(KIND_LABELS, kind) ? KIND_LABELS[kind] : em(kind);
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

export function renderSummaryMarkdown(summary) {
  const s = asObject(summary);
  const overall = asObject(s.overall);
  const reports = asArray(s.reports).filter((r) => r && typeof r === 'object');
  const products = asObject(s.products);
  const statusText = typeof overall.status === 'string' ? overall.status : 'NO_DATA';

  const lines = [];
  lines.push(`# MCP Report Hub: ${em(statusText)}`);
  lines.push(`Files: ${Number.isFinite(s.totals?.files) ? s.totals.files : 0}; reports: ${Number.isFinite(s.totals?.reports) ? s.totals.reports : reports.length}`);
  lines.push('');
  lines.push('## Overall reasons');
  lines.push('');
  const reasons = asArray(overall.reasons);
  if (reasons.length === 0) {
    lines.push('- none');
  } else {
    for (const reason of reasons) lines.push(`- ${em(reason)}`);
  }
  lines.push('');
  lines.push('## Products');
  lines.push('');
  lines.push('| Product | Reports | Level | Status |');
  lines.push('| --- | ---: | --- | --- |');
  for (const product of PRODUCT_ORDER) {
    const productReports = reports.filter((r) => r.product === product);
    const entry = asObject(products[product]);
    if (productReports.length === 0) {
      lines.push(`| ${em(product)} | 0 | none | no reports |`);
      continue;
    }
    const worst = worstReport(productReports);
    const status = asObject(worst.status);
    const value = typeof status.value === 'string' ? status.value : 'unknown';
    const level = typeof entry.level === 'string' ? entry.level : 'none';
    lines.push(
      `| ${em(product)} | ${Number.isFinite(entry.reports) ? entry.reports : productReports.length} | ` +
        `${em(level)} | ${em(value)} (${kindLabel(status.kind)}) |`
    );
  }
  lines.push('');
  lines.push('## Test success rate');
  lines.push('');
  const rate = asObject(s.testSuccessRate);
  if (Number.isInteger(rate.percent)) {
    lines.push(`${rate.percent}% (${rate.passed} passed, ${rate.failed} failed)`);
  } else {
    lines.push('No test results.');
  }
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  const findings = sortedFindings(reports);
  if (findings.length === 0) {
    lines.push('- none');
  } else {
    for (const item of findings) {
      const severity = em(item.finding.severity);
      const code = em(item.finding.code);
      const count = Number.isFinite(item.finding.count) ? item.finding.count : 0;
      lines.push(`- [${severity}] ${em(item.report.product)} ${em(item.report.id)} ${code} x${count}`);
    }
  }
  lines.push('');
  lines.push('## Problems');
  lines.push('');
  const problems = asArray(s.problems);
  if (problems.length === 0) {
    lines.push('- none');
  } else {
    for (const problem of problems) {
      const p = asObject(problem);
      const source = asObject(p.source);
      const label = typeof source.label === 'string' ? source.label : 'report-?';
      const detail = typeof p.detail === 'string' ? p.detail : '';
      lines.push(`- ${em(p.kind)} (${em(label)}): ${em(detail)}`);
    }
  }
  lines.push('');
  lines.push(MARKDOWN_FOOTER);
  lines.push('');
  return lines.join('\n');
}
