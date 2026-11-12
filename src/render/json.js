// JSON rendering: the reference serialization of a Summary.
// Key order is the insertion order produced by aggregation (fixed field order),
// so identical summaries serialize byte-identically.

export function renderSummaryJson(summary) {
  const value = summary === undefined ? null : summary;
  return JSON.stringify(value, null, 2) + '\n';
}
