// Adapter for joons-mcp-contract-test run reports (contract_run).
// SKIP results are counted, never failures.

import { hasOwn } from '../util/object.js';
import {
  MalformedError, reqObject, reqArray, reqString, reqEnum,
  reqCount, optDurationMs, pointer, FindingAggregator, shortHash, redactDetails,
} from '../model/normalize.js';

export const CONTRACT_VERDICTS = new Set(['PASS', 'FAIL']);

export const CONTRACT_RESULT_STATUSES = new Set(['PASS', 'FAIL', 'SKIP']);

export const CONTRACT_ASSERTION_ROOTS = new Set([
  'outcome',
  'isError',
  'errorCode',
  'errorMessageContains',
  'text.equals',
  'text.contains',
  'text.startsWith',
  'contentCount',
  'structuredContent.equals',
  'structuredContent.matches',
  'fields',
  'maxDurationMs',
  'timeout',
  'tool',
  'tools.mustInclude',
  'tools.mustNotInclude',
]);

function verdictLevel(verdict) {
  if (verdict === 'PASS') return 'ok';
  if (verdict === 'FAIL') return 'failure';
  return 'warning'; // unknown token: never green, never red
}

function assertionRoot(assertion) {
  const root = assertion.match(/^[^/<]*/)[0];
  return CONTRACT_ASSERTION_ROOTS.has(root) ? root : 'unknown';
}

export function adaptContractRun(value, identity, options = {}) {
  const detailsMode = options.details === true;
  reqObject(value, pointer(['value']));

  const verdictToken = reqEnum(value.verdict, CONTRACT_VERDICTS, pointer(['verdict']));
  const level = verdictLevel(verdictToken);

  const summary = reqObject(value.summary, pointer(['summary']));
  const total = reqCount(summary.total, pointer(['summary', 'total']));
  const passed = reqCount(summary.passed, pointer(['summary', 'passed']));
  const failed = reqCount(summary.failed, pointer(['summary', 'failed']));
  const skipped = reqCount(summary.skipped, pointer(['summary', 'skipped']));
  const durationMs = hasOwn(summary, 'durationMs') ? optDurationMs(summary.durationMs) : null;

  const results = reqArray(value.results, pointer(['results']));
  const aggregator = new FindingAggregator(detailsMode);
  let passedSeen = 0;
  let failedSeen = 0;
  let skippedSeen = 0;

  results.forEach((result, i) => {
    const rp = ['results', i];
    reqObject(result, pointer(rp));
    const status = reqString(result.status, pointer(rp.concat('status')));
    if (!CONTRACT_RESULT_STATUSES.has(status)) {
      throw new MalformedError(pointer(rp.concat('status')));
    }
    if (status === 'PASS') passedSeen += 1;
    else if (status === 'FAIL') failedSeen += 1;
    else skippedSeen += 1;

    if (status !== 'FAIL') return;

    const failures = reqArray(result.failures, pointer(rp.concat('failures')));
    if (failures.length === 0) {
      if (typeof result.reason === 'string' && result.reason.length > 0) {
        let detailItem = null;
        if (detailsMode) {
          detailItem = {
            subject: typeof result.id === 'string' ? redactDetails(result.id) : null,
            message: redactDetails(result.reason),
          };
        }
        aggregator.add('fail', 'reason', detailItem);
      }
      return;
    }

    failures.forEach((failure, j) => {
      const fpp = rp.concat('failures', j);
      reqObject(failure, pointer(fpp));
      const assertion = reqString(failure.assertion, pointer(fpp.concat('assertion')));
      const code = assertionRoot(assertion);
      let detailItem = null;
      if (detailsMode) {
        const subject = typeof result.id === 'string' ? redactDetails(result.id) : null;
        const messageText = typeof failure.message === 'string'
          ? assertion + ': ' + failure.message
          : assertion;
        detailItem = { subject, message: redactDetails(messageText) };
      }
      aggregator.add('fail', code, detailItem);
    });
  });

  if (total !== results.length || failed !== failedSeen ||
      passed !== passedSeen || skipped !== skippedSeen) {
    throw new MalformedError(pointer(['summary']));
  }

  const notAvailable = [];
  if (!hasOwn(summary, 'durationMs')) notAvailable.push('durationMs');

  return {
    id: null,
    source: {
      label: identity.label,
      sha256: shortHash(identity.sha256),
      fileName: identity.fileName ?? null,
    },
    product: 'contract-runner',
    reportType: 'contract_run',
    sourceFormat: 'joons-mcp-contract-test/report',
    schemaVersion: 1,
    productVersion: null,
    status: { kind: 'tests', value: verdictToken, level },
    timestamp: null,
    durationMs,
    counts: { total, passed, failed, skipped },
    findings: aggregator.toArray(),
    notAvailable,
  };
}
