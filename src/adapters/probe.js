// Adapter for joons-mcp-probe reports (probe_report).
// Reads ONLY the allowlisted fields from the contract; everything else is dropped.

import { hasOwn } from '../util/object.js';
import {
  MalformedError, reqObject, optObject, reqArray, reqString, reqEnum,
  optCount, optDurationMs, optTimestamp, safeVersion, pointer,
  FindingAggregator, shortHash, redactDetails,
} from '../model/normalize.js';

export const PROBE_STATUSES = new Set(['PASS', 'WARNING', 'FAIL']);

export const PROBE_FINDING_IDS = new Set([
  'TOOLS_EMPTY',
  'TOOL_SCHEMA_NOT_OBJECT',
  'TOOL_SCHEMA_INVALID',
  'SECRET_IN_RESPONSE',
]);

export const PROBE_FAILURE_KINDS = new Set([
  'handshake_failed',
  'invalid_response',
  'CLEANUP_INCOMPLETE',
  'RESPONSE_TOO_DEEP',
]);

const PROBE_SEVERITIES = new Set(['fail', 'warning', 'info']);

function statusLevel(status) {
  if (status === 'PASS') return 'ok';
  if (status === 'WARNING') return 'warning';
  if (status === 'FAIL') return 'failure';
  return 'warning'; // unknown token: never green, never red
}

function bump(counts, severity) {
  if (severity === 'fail') counts.fail += 1;
  else if (severity === 'warn') counts.warn += 1;
  else counts.info += 1;
}

export function adaptProbeReport(value, identity, options = {}) {
  const detailsMode = options.details === true;
  reqObject(value, pointer(['value']));

  const statusToken = reqEnum(value.status, PROBE_STATUSES, pointer(['status']));
  const level = statusLevel(statusToken);

  const tool = optObject(value.tool, pointer(['tool']));
  const productVersion = tool && hasOwn(tool, 'version') ? safeVersion(tool.version) : null;

  const timestamp = optTimestamp(value.finishedAt, pointer(['finishedAt']));

  const timings = optObject(value.timings, pointer(['timings']));
  const durationMs = timings && hasOwn(timings, 'totalMs') ? optDurationMs(timings.totalMs) : null;

  const tools = optObject(value.tools, pointer(['tools']));
  const toolsCount = tools && hasOwn(tools, 'count') ? optCount(tools.count) : null;

  const aggregator = new FindingAggregator(detailsMode);
  const counts = { fail: 0, warn: 0, info: 0 };

  const findings = reqArray(value.findings, pointer(['findings']));
  findings.forEach((finding, i) => {
    const fp = ['findings', i];
    reqObject(finding, pointer(fp));
    const code = reqEnum(finding.id, PROBE_FINDING_IDS, pointer(fp.concat('id')));
    const severityToken = reqString(finding.severity, pointer(fp.concat('severity')));
    if (!PROBE_SEVERITIES.has(severityToken)) {
      throw new MalformedError(pointer(fp.concat('severity')));
    }
    const severity = severityToken === 'warning' ? 'warn' : severityToken;
    let detailItem = null;
    if (detailsMode) {
      detailItem = {
        subject: typeof finding.tool === 'string' ? redactDetails(finding.tool) : null,
        message: typeof finding.message === 'string' ? redactDetails(finding.message) : null,
      };
    }
    aggregator.add(severity, code, detailItem);
    bump(counts, severity);
  });

  const failure = optObject(value.failure, pointer(['failure']));
  if (failure !== null) {
    let code = 'PROBE_FAILURE_UNKNOWN';
    if (typeof failure.kind === 'string' && PROBE_FAILURE_KINDS.has(failure.kind)) {
      code = 'PROBE_FAILURE_' + failure.kind.toUpperCase();
    }
    let detailItem = null;
    if (detailsMode) {
      detailItem = {
        subject: null,
        message: typeof failure.message === 'string' ? redactDetails(failure.message) : null,
      };
    }
    aggregator.add('fail', code, detailItem);
    bump(counts, 'fail');
  }

  const notAvailable = [];
  if (!hasOwn(value, 'finishedAt')) notAvailable.push('timestamp');
  if (!timings || !hasOwn(timings, 'totalMs')) notAvailable.push('durationMs');

  return {
    id: null,
    source: {
      label: identity.label,
      sha256: shortHash(identity.sha256),
      fileName: identity.fileName ?? null,
    },
    product: 'probe',
    reportType: 'probe_report',
    sourceFormat: '(none)',
    schemaVersion: 1,
    ...(productVersion !== null ? { productVersion } : {}),
    status: { kind: 'health', value: statusToken, level },
    timestamp,
    durationMs,
    counts: {
      tools: toolsCount,
      findingsFail: counts.fail,
      findingsWarning: counts.warn,
      findingsInfo: counts.info,
    },
    findings: aggregator.toArray(),
    notAvailable,
  };
}
