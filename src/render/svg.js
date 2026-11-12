// SVG badge rendering. Fixed flat-badge template, deterministic output.
// The only dynamic text is the label/value (fixed vocabulary or numbers from
// the summary), all escaped through escapeXml.

import { escapeXml } from '../security/escape.js';

export const BADGE_COLORS = Object.freeze({
  ok: '#1a7f37',
  warning: '#9a6700',
  failure: '#cf222e',
  info: '#57606a',
});

const LEVELS = new Set(['ok', 'warning', 'failure', 'info']);

// Width rule from the contract: 7 px per character + padding.
const CHAR_PX = 7;
const PAD_PX = 10;
const HEIGHT = 20;

function textWidth(text) {
  return String(text).length * CHAR_PX + PAD_PX;
}

export function renderBadge({ label, value, level }) {
  const safeLabel = String(label);
  const safeValue = String(value);
  const badgeLevel = LEVELS.has(level) ? level : 'info';
  const color = BADGE_COLORS[badgeLevel];
  const labelWidth = textWidth(safeLabel);
  const valueWidth = textWidth(safeValue);
  const totalWidth = labelWidth + valueWidth;
  const labelCenter = Math.round(labelWidth / 2);
  const valueCenter = labelWidth + Math.round(valueWidth / 2);
  const esc = escapeXml;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${HEIGHT}" role="img" aria-label="${esc(`${safeLabel}: ${safeValue}`)}">`,
    `<title>${esc(`${safeLabel}: ${safeValue}`)}</title>`,
    `<rect width="${labelWidth}" height="${HEIGHT}" rx="3" fill="#555"/>`,
    `<rect x="${labelWidth}" width="${valueWidth}" height="${HEIGHT}" rx="3" fill="${color}"/>`,
    `<g fill="#ffffff" font-family="sans-serif" font-size="11" font-weight="bold">`,
    `<text x="${labelCenter}" y="14" text-anchor="middle">${esc(safeLabel)}</text>`,
    `<text x="${valueCenter}" y="14" text-anchor="middle">${esc(safeValue)}</text>`,
    `</g>`,
    `</svg>`,
  ].join('\n') + '\n';
}

const PRODUCT_ORDER = ['probe', 'diff', 'policy-gate', 'mock-server', 'contract-runner'];

const DIFF_VALUE_BY_RISK = Object.freeze({
  high: { value: 'BREAKING', level: 'failure' },
  unknown: { value: 'UNKNOWN', level: 'warning' },
  low: { value: 'NON-BREAKING', level: 'ok' },
  none: { value: 'NO CHANGES', level: 'ok' },
});

const OVERALL_LEVEL = Object.freeze({
  PASS: 'ok',
  WARN: 'warning',
  FAIL: 'failure',
  NO_DATA: 'info',
});

const VALIDATION_VALUE_MAP = Object.freeze({
  VALID: { value: 'PASS', level: 'ok' },
  VALID_WITH_WARNINGS: { value: 'WARN', level: 'warning' },
  INVALID: { value: 'FAIL', level: 'failure' },
});

function safeCounts(products, product) {
  const entry = products && typeof products === 'object' ? products[product] : null;
  if (!entry || typeof entry !== 'object') return null;
  const counts = entry.counts && typeof entry.counts === 'object' ? entry.counts : {};
  return { entry, counts };
}

function productBadge(product, info) {
  const labels = {
    probe: 'MCP Probe',
    diff: 'MCP Diff',
    'policy-gate': 'Policy Gate',
    'mock-server': 'Mock Server',
    'contract-runner': 'Contract Tests',
  };
  return { name: product, svg: renderBadge({ label: labels[product], value: info.value, level: info.level }) };
}

export function buildBadges(summary) {
  const s = summary && typeof summary === 'object' ? summary : {};
  const products = s.products && typeof s.products === 'object' ? s.products : {};
  const overall = s.overall && typeof s.overall === 'object' ? s.overall : {};
  const overallStatus = typeof overall.status === 'string' ? overall.status : 'NO_DATA';
  const overallText = overallStatus === 'NO_DATA' ? 'NO DATA' : overallStatus;
  const badges = [
    {
      name: 'overall',
      svg: renderBadge({
        label: 'MCP reports',
        value: overallText,
        level: OVERALL_LEVEL[overallStatus] || 'info',
      }),
    },
  ];
  for (const product of PRODUCT_ORDER) {
    const probe = safeCounts(products, product);
    if (!probe || typeof probe.entry.reports !== 'number' || probe.entry.reports < 1) continue;
    const worst = typeof probe.entry.worstStatus === 'string' ? probe.entry.worstStatus : '';
    if (product === 'diff') {
      const mapped = DIFF_VALUE_BY_RISK[worst] || { value: 'UNKNOWN', level: 'warning' };
      badges.push(productBadge(product, mapped));
    } else if (product === 'mock-server') {
      const calls = Number.isFinite(probe.counts.calls) ? probe.counts.calls : 0;
      badges.push(productBadge(product, { value: `${calls} calls`, level: 'info' }));
    } else if (product === 'contract-runner') {
      const passed = Number.isFinite(probe.counts.passed) ? probe.counts.passed : 0;
      const failed = Number.isFinite(probe.counts.failed) ? probe.counts.failed : 0;
      if (passed + failed === 0) {
        const level = probe.entry.level === 'failure' ? 'failure' : 'ok';
        badges.push(productBadge(product, { value: 'NO TESTS', level }));
      } else {
        const percent = Math.floor((100 * passed) / (passed + failed));
        const level = failed > 0 ? 'failure' : 'ok';
        badges.push(productBadge(product, { value: `${percent}% PASS`, level }));
      }
    } else if (product === 'policy-gate' && VALIDATION_VALUE_MAP[worst]) {
      badges.push(productBadge(product, VALIDATION_VALUE_MAP[worst]));
    } else {
      const level = ['ok', 'warning', 'failure', 'info'].includes(probe.entry.level)
        ? probe.entry.level
        : 'info';
      badges.push(productBadge(product, { value: worst || 'unknown', level }));
    }
  }
  return badges;
}
