// Shared normalization helpers for the CORE adapters.
// Allowlist-only: every value that reaches a normalized report passes through here.

import { isPlainObject, hasOwn, safePathSegment } from '../util/object.js';
import { isSafeVersion, isIsoTimestamp, redactText } from '../security/redact.js';

export const PRODUCT_ORDER = ['probe', 'diff', 'policy-gate', 'mock-server', 'contract-runner'];

export const LEVEL_RANK = { none: 0, info: 1, ok: 2, warning: 3, failure: 4 };

export const FINDING_SEVERITY_RANK = { fail: 0, warn: 1, info: 2 };

export class MalformedError extends Error {
  constructor(pointer) {
    super('malformed report at ' + pointer);
    this.pointer = pointer;
  }
}

export function pointer(segments) {
  return '/' + segments.map((seg, i) => safePathSegment(seg, i)).join('/');
}

export function reqObject(value, ptr) {
  if (!isPlainObject(value)) throw new MalformedError(ptr);
  return value;
}

export function optObject(value, ptr) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) throw new MalformedError(ptr);
  return value;
}

export function reqArray(value, ptr) {
  if (!Array.isArray(value)) throw new MalformedError(ptr);
  return value;
}

export function reqString(value, ptr) {
  if (typeof value !== 'string') throw new MalformedError(ptr);
  return value;
}

// Integer in 0..1e9 or throw (for verdict-driving summary counts).
export function reqCount(value, ptr) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1e9) {
    throw new MalformedError(ptr);
  }
  return value;
}

// Integer in 0..1e9 or null (for best-effort nullable counts).
export function optCount(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1e9) return null;
  return value;
}

export function optDurationMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

// String token: known -> value, anything else (incl. unknown strings) handled by caller.
export function reqEnum(value, knownSet, ptr) {
  reqString(value, ptr);
  return knownSet.has(value) ? value : 'unknown';
}

export function safeVersion(value) {
  return isSafeVersion(value) ? value : null;
}

// ISO-8601 timestamp; wrong type throws, bad pattern -> null.
export function optTimestamp(value, ptr) {
  if (value === null || value === undefined) return null;
  reqString(value, ptr);
  return isIsoTimestamp(value) ? value : null;
}

// probe/policy date: YYYY-MM-DD validated as a real calendar date.
export function optDate(value, ptr) {
  if (value === null || value === undefined) return null;
  reqString(value, ptr);
  if (!/^\d{4}-\d\d-\d\d$/.test(value)) return null;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  const d = Number(value.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return value;
}

export function shortHash(sha256) {
  return typeof sha256 === 'string' ? sha256.slice(0, 12) : '000000000000';
}

export function redactDetails(text) {
  return redactText(text, { maxLength: 200 });
}

// Aggregate items into findings [{severity, code, count, details?}] keyed by (severity, code).
export class FindingAggregator {
  constructor(detailsMode) {
    this.detailsMode = detailsMode;
    this.map = new Map();
  }

  add(severity, code, detailItem) {
    const key = severity + '' + code;
    let entry = this.map.get(key);
    if (!entry) {
      entry = { severity, code, count: 0 };
      if (this.detailsMode) entry.details = [];
      this.map.set(key, entry);
    }
    entry.count += 1;
    if (this.detailsMode && detailItem) entry.details.push(detailItem);
    return entry;
  }

  toArray() {
    const list = [...this.map.values()];
    list.sort((a, b) => {
      const r = FINDING_SEVERITY_RANK[a.severity] - FINDING_SEVERITY_RANK[b.severity];
      if (r !== 0) return r;
      if (a.code < b.code) return -1;
      if (a.code > b.code) return 1;
      return 0;
    });
    return list;
  }
}

// Build a plain object from sorted [key, value] entries; safe for hostile keys
// (Object.fromEntries uses CreateDataProperty, so "__proto__" stays an own key).
export function sortedObject(entries) {
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return Object.fromEntries(entries);
}

export function hasField(obj, key) {
  return hasOwn(obj, key);
}
