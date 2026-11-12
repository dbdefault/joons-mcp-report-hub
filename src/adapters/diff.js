// Adapter for joons-mcp-diff compare results (diff_result).

import { hasOwn } from '../util/object.js';
import {
  MalformedError, reqObject, reqArray, reqString, reqEnum, reqCount,
  pointer, FindingAggregator, shortHash, redactDetails,
} from '../model/normalize.js';

export const DIFF_RISKS = new Set(['none', 'low', 'unknown', 'high']);

export const DIFF_CHANGE_KINDS = new Set([
  'tool_removed',
  'tool_added',
  'enum_values_removed',
  'enum_values_added',
  'required_added',
  'constraint_changed',
  'property_added',
  'description_changed',
]);

const DIFF_SEVERITIES = new Set(['BREAKING', 'NON_BREAKING', 'UNKNOWN']);

function riskLevel(risk) {
  if (risk === 'high') return 'failure';
  if (risk === 'unknown') return 'warning';
  return 'ok'; // none, low
}

const SEVERITY_TO_FINDING = { BREAKING: 'fail', UNKNOWN: 'warn', NON_BREAKING: 'info' };

export function adaptDiffResult(value, identity, options = {}) {
  const detailsMode = options.details === true;
  reqObject(value, pointer(['value']));

  const summary = reqObject(value.summary, pointer(['summary']));
  const riskToken = reqEnum(summary.risk, DIFF_RISKS, pointer(['summary', 'risk']));
  const level = riskLevel(riskToken);

  const summaryKeys = ['added', 'removed', 'changed', 'unchanged', 'breaking', 'nonBreaking', 'unknown'];
  const counts = {};
  for (const key of summaryKeys) {
    counts[key] = reqCount(summary[key], pointer(['summary', key]));
  }

  const tools = reqArray(value.tools, pointer(['tools']));
  const aggregator = new FindingAggregator(detailsMode);
  const seen = { BREAKING: 0, UNKNOWN: 0, NON_BREAKING: 0 };

  tools.forEach((tool, i) => {
    const tp = ['tools', i];
    reqObject(tool, pointer(tp));
    const changes = reqArray(tool.changes, pointer(tp.concat('changes')));
    changes.forEach((change, j) => {
      const cp = tp.concat('changes', j);
      reqObject(change, pointer(cp));
      const severity = reqString(change.severity, pointer(cp.concat('severity')));
      if (!DIFF_SEVERITIES.has(severity)) {
        throw new MalformedError(pointer(cp.concat('severity')));
      }
      const code = reqEnum(change.kind, DIFF_CHANGE_KINDS, pointer(cp.concat('kind')));
      seen[severity] += 1;
      let detailItem = null;
      if (detailsMode) {
        detailItem = {
          subject: typeof tool.name === 'string' ? redactDetails(tool.name) : null,
          message: typeof change.message === 'string' ? redactDetails(change.message) : null,
        };
      }
      aggregator.add(SEVERITY_TO_FINDING[severity], code, detailItem);
    });
  });

  if (counts.breaking !== seen.BREAKING || counts.unknown !== seen.UNKNOWN ||
      counts.nonBreaking !== seen.NON_BREAKING) {
    throw new MalformedError(pointer(['summary']));
  }

  return {
    id: null,
    source: {
      label: identity.label,
      sha256: shortHash(identity.sha256),
      fileName: identity.fileName ?? null,
    },
    product: 'diff',
    reportType: 'diff_result',
    sourceFormat: 'joons-mcp-diff/result',
    schemaVersion: 1,
    productVersion: null,
    status: { kind: 'change_risk', value: riskToken, level },
    timestamp: null,
    durationMs: null,
    counts,
    findings: aggregator.toArray(),
    notAvailable: ['timestamp', 'durationMs'],
  };
}
