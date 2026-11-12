// Adapter for joons-mcp-mock-server session reports (mock_session).
// A call RECORDING: level info, value RECORDED, NEVER a verdict, no fabricated findings.

import { hasOwn } from '../util/object.js';
import {
  MalformedError, reqObject, optCount, pointer, shortHash, redactDetails,
} from '../model/normalize.js';

export const MOCK_OUTCOMES = new Set([
  'result',
  'is_error',
  'protocol_error',
  'unknown_tool',
  'invalid_arguments',
  'timeout',
  'busy',
]);

export function adaptMockSession(value, identity, options = {}) {
  const detailsMode = options.details === true;
  reqObject(value, pointer(['value']));

  const totals = reqObject(value.totals, pointer(['totals']));
  const calls = hasOwn(totals, 'calls') ? optCount(totals.calls) : null;

  const byOutcome = { unknown: 0 };
  if (hasOwn(totals, 'byOutcome')) {
    const raw = reqObject(totals.byOutcome, pointer(['totals', 'byOutcome']));
    for (const key of Object.keys(raw)) {
      const n = optCount(raw[key]);
      if (n === null) throw new MalformedError(pointer(['totals', 'byOutcome', key]));
      const target = MOCK_OUTCOMES.has(key) ? key : 'unknown';
      byOutcome[target] = (byOutcome[target] ?? 0) + n;
    }
  }
  if (byOutcome.unknown === 0) delete byOutcome.unknown;

  const droppedCalls = hasOwn(value, 'droppedCalls') ? optCount(value.droppedCalls) : null;

  const report = {
    id: null,
    source: {
      label: identity.label,
      sha256: shortHash(identity.sha256),
      fileName: identity.fileName ?? null,
    },
    product: 'mock-server',
    reportType: 'mock_session',
    sourceFormat: 'joons-mcp-mock-server/report',
    schemaVersion: 1,
    productVersion: null,
    status: { kind: 'recording', value: 'RECORDED', level: 'info' },
    timestamp: null,
    durationMs: null,
    counts: { calls, droppedCalls, byOutcome },
    findings: [],
    notAvailable: ['timestamp', 'durationMs'],
  };

  if (detailsMode && typeof value.scenario === 'string') {
    report.scenario = redactDetails(value.scenario);
  }

  return report;
}
