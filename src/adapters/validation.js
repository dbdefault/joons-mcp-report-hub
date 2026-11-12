// Adapter for the three validation report formats (validation):
//   joons-mcp-policy-gate/policy-validation, joons-mcp-mock-server/validation,
//   joons-mcp-contract-test/validation.
// Default mode: no findings. Details mode: error/warning messages as redacted info.

import {
  MalformedError, reqObject, reqArray, pointer, shortHash, redactDetails,
} from '../model/normalize.js';

const VALIDATION_PRODUCTS = new Set(['policy-gate', 'mock-server', 'contract-runner']);

function messageOf(item) {
  if (typeof item === 'string') return item;
  if (item !== null && typeof item === 'object' && !Array.isArray(item) &&
      typeof item.message === 'string') {
    return item.message;
  }
  return null;
}

export function adaptValidation(value, identity, options = {}) {
  const detailsMode = options.details === true;
  reqObject(value, pointer(['value']));

  const product = VALIDATION_PRODUCTS.has(identity.product) ? identity.product : 'policy-gate';

  if (typeof value.ok !== 'boolean') throw new MalformedError(pointer(['ok']));

  const errors = reqArray(value.errors, pointer(['errors']));
  const warnings = reqArray(value.warnings, pointer(['warnings']));

  let statusValue;
  let level;
  if (value.ok === false) {
    statusValue = 'INVALID';
    level = 'failure';
  } else if (warnings.length > 0) {
    statusValue = 'VALID_WITH_WARNINGS';
    level = 'warning';
  } else {
    statusValue = 'VALID';
    level = 'ok';
  }

  const findings = [];
  if (detailsMode) {
    const errorDetails = [];
    for (const item of errors) {
      const m = messageOf(item);
      if (m !== null) errorDetails.push({ subject: null, message: redactDetails(m) });
    }
    if (errorDetails.length > 0) {
      findings.push({ severity: 'fail', code: 'validation_error', count: errorDetails.length, details: errorDetails });
    }
    const warningDetails = [];
    for (const item of warnings) {
      const m = messageOf(item);
      if (m !== null) warningDetails.push({ subject: null, message: redactDetails(m) });
    }
    if (warningDetails.length > 0) {
      findings.push({ severity: 'warn', code: 'validation_warning', count: warningDetails.length, details: warningDetails });
    }
  }

  const notAvailable = ['timestamp', 'durationMs'];

  return {
    id: null,
    source: {
      label: identity.label,
      sha256: shortHash(identity.sha256),
      fileName: identity.fileName ?? null,
    },
    product,
    reportType: 'validation',
    sourceFormat: typeof identity.sourceFormat === 'string' ? identity.sourceFormat : '(none)',
    schemaVersion: 1,
    productVersion: null,
    status: { kind: 'validation', value: statusValue, level },
    timestamp: null,
    durationMs: null,
    counts: { errors: errors.length, warnings: warnings.length },
    findings,
    notAvailable,
  };
}
