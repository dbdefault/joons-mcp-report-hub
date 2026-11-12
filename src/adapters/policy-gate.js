// Adapter for joons-mcp-policy-gate check results (policy_check).

import { hasOwn } from '../util/object.js';
import {
  MalformedError, reqObject, reqArray, reqString, reqEnum, reqCount,
  optDate, pointer, FindingAggregator, shortHash, redactDetails,
} from '../model/normalize.js';

export const POLICY_VERDICTS = new Set(['PASS', 'WARN', 'FAIL']);

export const POLICY_RULES = new Set([
  'tool_denied',
  'tool_not_allowed',
  'description_missing',
  'description_too_short',
  'input_schema_invalid',
  'annotations_missing',
  'approval_missing',
  'approval_expired',
  'required_tool_missing',
  'max_tools_exceeded',
  'approval_unused',
]);

const POLICY_LEVELS = new Set(['fail', 'warn']);

function verdictLevel(verdict) {
  if (verdict === 'PASS') return 'ok';
  if (verdict === 'WARN') return 'warning';
  if (verdict === 'FAIL') return 'failure';
  return 'warning'; // unknown token: never green, never red
}

export function adaptPolicyCheck(value, identity, options = {}) {
  const detailsMode = options.details === true;
  reqObject(value, pointer(['value']));

  const verdictToken = reqEnum(value.verdict, POLICY_VERDICTS, pointer(['verdict']));
  const level = verdictLevel(verdictToken);

  const timestamp = optDate(value.date, pointer(['date']));

  const summary = reqObject(value.summary, pointer(['summary']));
  const tools = reqCount(summary.tools, pointer(['summary', 'tools']));
  const fail = reqCount(summary.fail, pointer(['summary', 'fail']));
  const warn = reqCount(summary.warn, pointer(['summary', 'warn']));

  const aggregator = new FindingAggregator(detailsMode);
  const findings = reqArray(value.findings, pointer(['findings']));
  let failSeen = 0;
  let warnSeen = 0;

  findings.forEach((finding, i) => {
    const fp = ['findings', i];
    reqObject(finding, pointer(fp));
    const code = reqEnum(finding.rule, POLICY_RULES, pointer(fp.concat('rule')));
    const findingLevel = reqString(finding.level, pointer(fp.concat('level')));
    if (!POLICY_LEVELS.has(findingLevel)) {
      throw new MalformedError(pointer(fp.concat('level')));
    }
    if (findingLevel === 'fail') failSeen += 1;
    else warnSeen += 1;
    let detailItem = null;
    if (detailsMode) {
      detailItem = {
        subject: typeof finding.tool === 'string' ? redactDetails(finding.tool) : null,
        message: typeof finding.message === 'string' ? redactDetails(finding.message) : null,
      };
    }
    aggregator.add(findingLevel, code, detailItem);
  });

  if (fail !== failSeen || warn !== warnSeen) {
    throw new MalformedError(pointer(['summary']));
  }

  const notAvailable = [];
  if (!hasOwn(value, 'date')) notAvailable.push('timestamp');
  notAvailable.push('durationMs');

  return {
    id: null,
    source: {
      label: identity.label,
      sha256: shortHash(identity.sha256),
      fileName: identity.fileName ?? null,
    },
    product: 'policy-gate',
    reportType: 'policy_check',
    sourceFormat: 'joons-mcp-policy-gate/result',
    schemaVersion: 1,
    productVersion: null,
    status: { kind: 'policy', value: verdictToken, level },
    timestamp,
    durationMs: null,
    counts: { tools, fail, warn },
    findings: aggregator.toArray(),
    notAvailable,
  };
}
