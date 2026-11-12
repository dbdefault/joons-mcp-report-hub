// adaptReport: single entry point. Dispatches on identity.reportType
// (classification is done earlier by identifyReport in the input layer).

import { MalformedError } from '../model/normalize.js';
import { adaptProbeReport } from './probe.js';
import { adaptDiffResult } from './diff.js';
import { adaptPolicyCheck } from './policy-gate.js';
import { adaptMockSession } from './mock-server.js';
import { adaptContractRun } from './contract-runner.js';
import { adaptValidation } from './validation.js';

const ADAPTERS = {
  probe_report: adaptProbeReport,
  diff_result: adaptDiffResult,
  policy_check: adaptPolicyCheck,
  mock_session: adaptMockSession,
  contract_run: adaptContractRun,
  validation: adaptValidation,
};

// value: parsed JSON; identity: {label, sha256, reportType, product?, sourceFormat?, fileName?}
// Returns {ok: true, report} or {ok: false, kind: 'malformed_report', detail: <pointer>}.
export function adaptReport(value, identity, options = {}) {
  const adapter = ADAPTERS[identity && identity.reportType];
  if (!adapter) {
    return { ok: false, kind: 'malformed_report', detail: '/reportType' };
  }
  try {
    const report = adapter(value, identity ?? {}, options ?? {});
    return { ok: true, report };
  } catch (err) {
    if (err instanceof MalformedError) {
      return { ok: false, kind: 'malformed_report', detail: err.pointer };
    }
    throw err;
  }
}

export { MalformedError };
