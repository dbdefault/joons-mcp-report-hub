// src/input/identify.js - INPUT owner. Report format identification.
import { isPlainObject, hasOwn } from '../util/object.js';

const UNKNOWN_DETAIL = 'unrecognized report format';

// Known `format` strings -> identity. Snapshots are recognized input data,
// not reports, so they map to ignored_input.
const KNOWN_FORMATS = new Map([
  ['joons-mcp-diff/result', { product: 'diff', reportType: 'diff_result' }],
  ['joons-mcp-policy-gate/result', { product: 'policy-gate', reportType: 'policy_check' }],
  ['joons-mcp-mock-server/report', { product: 'mock-server', reportType: 'mock_session' }],
  ['joons-mcp-contract-test/report', { product: 'contract-runner', reportType: 'contract_run' }],
  ['joons-mcp-policy-gate/policy-validation', { product: 'policy-gate', reportType: 'validation' }],
  ['joons-mcp-mock-server/validation', { product: 'mock-server', reportType: 'validation' }],
  ['joons-mcp-contract-test/validation', { product: 'contract-runner', reportType: 'validation' }],
]);

const IGNORED_FORMATS = new Set(['joons-mcp-diff/snapshot']);

function unknownFormat() {
  return { ok: false, kind: 'unknown_format', detail: UNKNOWN_DETAIL };
}

// value: parsed JSON. Never echoes arbitrary strings: unknown formats give a
// fixed phrase; unsupported_version gives known-format + version number only.
export function identifyReport(value) {
  if (!isPlainObject(value)) return unknownFormat();

  if (hasOwn(value, 'format')) {
    const format = value.format;
    if (typeof format !== 'string') return unknownFormat();
    if (IGNORED_FORMATS.has(format)) {
      return { ok: false, kind: 'ignored_input', detail: format };
    }
    const known = KNOWN_FORMATS.get(format);
    if (!known) return unknownFormat();
    if (value.schemaVersion !== 1) {
      const version =
        typeof value.schemaVersion === 'number' && Number.isFinite(value.schemaVersion)
          ? String(value.schemaVersion)
          : 'unknown';
      return { ok: false, kind: 'unsupported_version', detail: `${format} ${version}` };
    }
    return {
      ok: true,
      product: known.product,
      reportType: known.reportType,
      sourceFormat: format,
    };
  }

  // Probe report: the only format with NO `format` key.
  if (
    value.schemaVersion === 1 &&
    isPlainObject(value.tool) &&
    value.tool.name === 'joons-mcp-probe' &&
    hasOwn(value, 'status') &&
    hasOwn(value, 'target')
  ) {
    return {
      ok: true,
      product: 'probe',
      reportType: 'probe_report',
      sourceFormat: '(none)',
    };
  }
  return unknownFormat();
}
