import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBadges, BADGE_COLORS } from '../src/render/svg.js';
import {
  richSummary,
  noDataSummary,
  emptySummary,
  minimalSummary,
  productsMap,
  PAYLOADS,
} from './fixtures-summary.js';

function badgeByName(badges, name) {
  const badge = badges.find((b) => b.name === name);
  assert.ok(badge, `missing badge: ${name}`);
  return badge.svg;
}

test('rich summary yields the overall badge plus one per product with reports', () => {
  const badges = buildBadges(richSummary());
  assert.deepEqual(
    badges.map((b) => b.name),
    ['overall', 'probe', 'diff', 'policy-gate', 'mock-server', 'contract-runner']
  );
});

test('overall badge value equals the overall status text and color by level', () => {
  const failSvg = badgeByName(buildBadges(richSummary()), 'overall');
  assert.ok(failSvg.includes('<title>MCP reports: FAIL</title>'));
  assert.ok(failSvg.includes(`fill="${BADGE_COLORS.failure}"`));

  const noData = badgeByName(buildBadges(noDataSummary()), 'overall');
  assert.ok(noData.includes('<title>MCP reports: NO DATA</title>'));
  assert.ok(noData.includes(`fill="${BADGE_COLORS.info}"`));
});

test('empty summary yields only the overall badge', () => {
  const badges = buildBadges(emptySummary());
  assert.equal(badges.length, 1);
  assert.equal(badges[0].name, 'overall');
});

test('probe badge shows the worst status text', () => {
  const svg = badgeByName(buildBadges(richSummary()), 'probe');
  assert.ok(svg.includes('<title>MCP Probe: PASS</title>'));
  const warn = minimalSummary({
    overall: { status: 'WARN', reasons: ['warning_report'] },
    products: productsMap({
      probe: { reports: 1, level: 'warning', worstStatus: 'WARNING', counts: {} },
    }),
  });
  assert.ok(badgeByName(buildBadges(warn), 'probe').includes('<title>MCP Probe: WARNING</title>'));
});

test('diff badge maps the worst risk to the contract vocabulary', () => {
  const cases = [
    ['high', 'BREAKING', 'failure'],
    ['unknown', 'UNKNOWN', 'warning'],
    ['low', 'NON-BREAKING', 'ok'],
    ['none', 'NO CHANGES', 'ok'],
  ];
  for (const [risk, text, level] of cases) {
    const summary = minimalSummary({
      overall: { status: risk === 'high' ? 'FAIL' : 'PASS', reasons: [] },
      products: productsMap({
        diff: { reports: 1, level, worstStatus: risk, counts: {} },
      }),
    });
    const svg = badgeByName(buildBadges(summary), 'diff');
    assert.ok(svg.includes(`<title>MCP Diff: ${text}</title>`), `${risk} -> ${text}`);
    assert.ok(svg.includes(`fill="${BADGE_COLORS[level]}"`));
  }
});

test('policy-gate badge shows the verdict text', () => {
  for (const [verdict, level] of [['PASS', 'ok'], ['WARN', 'warning'], ['FAIL', 'failure']]) {
    const summary = minimalSummary({
      overall: { status: verdict, reasons: [] },
      products: productsMap({
        'policy-gate': { reports: 1, level, worstStatus: verdict, counts: {} },
      }),
    });
    assert.ok(
      badgeByName(buildBadges(summary), 'policy-gate').includes(`<title>Policy Gate: ${verdict}</title>`)
    );
  }
});

test('contract badge floors the summed percent and never shows 100 with a failure', () => {
  const cases = [
    [99, 1, '99% PASS', 'failure'],
    [199, 1, '99% PASS', 'failure'],
    [1, 0, '100% PASS', 'ok'],
    [3, 1, '75% PASS', 'failure'],
  ];
  for (const [passed, failed, text, level] of cases) {
    const summary = minimalSummary({
      overall: { status: failed > 0 ? 'FAIL' : 'PASS', reasons: [] },
      products: productsMap({
        'contract-runner': { reports: 1, level, worstStatus: failed > 0 ? 'FAIL' : 'PASS', counts: { passed, failed } },
      }),
      testSuccessRate: { passed, failed, percent: Math.floor((100 * passed) / (passed + failed)) },
    });
    const svg = badgeByName(buildBadges(summary), 'contract-runner');
    assert.ok(svg.includes(`<title>Contract Tests: ${text}</title>`), `${passed}/${failed} -> ${text}`);
    assert.ok(svg.includes(`fill="${BADGE_COLORS[level]}"`));
    if (failed > 0) assert.ok(!svg.includes('100% PASS'));
  }
});

test('contract badge shows NO TESTS when no run counts exist', () => {
  const summary = minimalSummary({
    overall: { status: 'WARN', reasons: ['warning_report'] },
    products: productsMap({
      'contract-runner': { reports: 1, level: 'warning', worstStatus: 'VALID_WITH_WARNINGS', counts: { errors: 0, warnings: 2 } },
    }),
  });
  const svg = badgeByName(buildBadges(summary), 'contract-runner');
  assert.ok(svg.includes('<title>Contract Tests: NO TESTS</title>'));
});

test('mock badge shows the summed call count and is always gray', () => {
  const svg = badgeByName(buildBadges(richSummary()), 'mock-server');
  assert.ok(svg.includes('<title>Mock Server: 42 calls</title>'));
  assert.ok(svg.includes(`fill="${BADGE_COLORS.info}"`));
  assert.ok(!svg.includes(`fill="${BADGE_COLORS.ok}"`));
  assert.ok(!svg.includes(`fill="${BADGE_COLORS.failure}"`));

  const zero = minimalSummary({
    overall: { status: 'NO_DATA', reasons: ['no_verdict_reports'] },
    products: productsMap({
      'mock-server': { reports: 1, level: 'info', worstStatus: 'RECORDED', counts: { calls: 0 } },
    }),
  });
  assert.ok(badgeByName(buildBadges(zero), 'mock-server').includes('<title>Mock Server: 0 calls</title>'));
});

test('badge values agree with the summary and output is deterministic', () => {
  const summary = richSummary();
  const a = buildBadges(summary);
  const b = buildBadges(summary);
  assert.deepEqual(a, b);
  const expectedPercent = Math.floor(
    (100 * summary.products['contract-runner'].counts.passed) /
      (summary.products['contract-runner'].counts.passed + summary.products['contract-runner'].counts.failed)
  );
  assert.ok(
    badgeByName(a, 'contract-runner').includes(`<title>Contract Tests: ${expectedPercent}% PASS</title>`)
  );
  const calls = summary.products['mock-server'].counts.calls;
  assert.ok(badgeByName(a, 'mock-server').includes(`<title>Mock Server: ${calls} calls</title>`));
});

test('hostile summary fields cannot break badge text', () => {
  const summary = minimalSummary({
    overall: { status: 'FAIL', reasons: [] },
    products: productsMap({
      probe: { reports: 1, level: 'failure', worstStatus: PAYLOADS.script, counts: {} },
    }),
  });
  const svg = badgeByName(buildBadges(summary), 'probe');
  assert.ok(!svg.includes(PAYLOADS.script));
  assert.ok(svg.includes('&lt;script&gt;'));
});
