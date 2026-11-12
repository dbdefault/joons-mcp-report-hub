// src/security/redact.js - INPUT owner. Free-text redaction for --details mode.
import { stripControls } from '../util/object.js';

export const SAFE_VERSION_RE = /^[0-9]{1,6}(\.[0-9]{1,6}){0,3}(-[0-9A-Za-z.]{1,24})?$/;

export function isSafeVersion(s) {
  return typeof s === 'string' && SAFE_VERSION_RE.test(s);
}

const ISO_TS_RE =
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,9})?(Z|[+-]\d\d:\d\d)$/;

export function isIsoTimestamp(s) {
  return typeof s === 'string' && ISO_TS_RE.test(s);
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// YYYY-MM-DD validated as a real Gregorian date (month 1-12, day in month,
// leap years). Used for probe/policy date fields.
export function isRealYmdDate(s) {
  if (typeof s !== 'string' || !YMD_RE.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (m < 1 || m > 12) return false;
  const dim = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d >= 1 && d <= dim[m - 1];
}

// Token scans use linear non-whitespace runs; other passes use bounded
// quantifiers and do not nest quantified groups.
const RE_URL = /[a-z][a-z0-9+.-]{1,15}:\/\/\S+/g;
const RE_WIN_UNC_PATH =
  /(?<![A-Za-z0-9_])(?:[A-Za-z]:[\\/][^\s]{0,300}|\\\\[^\s\\/]{1,63}[\\/][^\s]{0,300})/g;
const RE_POSIX_PATH =
  /(?<![A-Za-z0-9_/])(?:~\/|\/(?:[^\s/]{1,300}\/))[^\s]{0,300}/g;
const RE_EMAIL =
  /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,255}(?:\.[A-Za-z0-9-]{1,255}){0,16}\.[A-Za-z]{2,24}/g;
const RE_IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const RE_BEARER = /\bBearer[ \t]+\S+/gi;
const RE_CREDENTIAL = /\b(?:sk-|ghp_|gho_|github_pat_|AKIA|xox[bap]-|glpat-)\S{6,}/gi;
const RE_JWT = /\beyJ[A-Za-z0-9_-]{0,64}\.\S{1,2048}\.\S{1,2048}/g;

const SENSITIVE_NAMES =
  'password|passwd|secret|token|apikey|api_key|api-key|authorization|auth' +
  '|credential|cookie|session|privatekey|private_key';
const RE_PAIR = new RegExp(
  `("?)(${SENSITIVE_NAMES})([A-Za-z0-9_-]{0,32})("?)[ \\t]*(:|=)[ \\t]*` +
  `(?:"[^"]{0,2048}"|'[^']{0,2048}'|[^\\s,"']{1,2048})`,
  'gi',
);
const RE_OPAQUE = /[A-Za-z0-9_+/=-]{24,}/g;
const RE_FORMAT = /[\p{Cf}\u115f\u1160\u3164\uffa0\u034f\ufe00-\ufe0f\u{e0000}-\u{e007f}]/gu;
const RE_NORMALIZE = /%[0-9a-fA-F]{2}|[\p{Cf}\u115f\u1160\u3164\uffa0\u034f\ufe00-\ufe0f\u{e0000}-\u{e007f}]/gu;
const RE_ENCODED = /(?<![A-Za-z0-9_+/=-])[A-Za-z0-9_+/-]{8,}={0,2}(?![A-Za-z0-9_+/=-])/g;
const RE_DECODED_CREDENTIAL = /^(?:(?:sk-|ghp_|gho_|github_pat_|AKIA|xox[bap]-|glpat-)\S{6,}|Bearer[ \t]+\S{6,})/i;

// Match on a normalized view while preserving the corresponding original span.
function maskEncodedCredentials(original) {
  const changed = original.includes('%') || RE_FORMAT.test(original);
  RE_FORMAT.lastIndex = 0;
  const normalized = changed ? original.replace(RE_NORMALIZE, (m) => m[0] === '%'
    ? String.fromCharCode(parseInt(m.slice(1), 16)) : '') : original;
  const spans = [];
  const add = (m) => spans.push([m.index, m.index + m[0].length]);
  if (changed && normalized !== original) {
    for (const m of normalized.matchAll(RE_CREDENTIAL)) add(m);
    for (const m of normalized.matchAll(RE_BEARER)) add(m);
  }
  for (const m of normalized.matchAll(RE_ENCODED)) {
    // The first base64 sextet must encode the first letter of a known prefix.
    if (!'YQZRcUeW'.includes(m[0][0])) continue;
    const decoded = Buffer.from(m[0].slice(0, 128), 'base64').toString('utf8');
    if (RE_DECODED_CREDENTIAL.test(decoded)) add(m);
  }
  if (spans.length === 0) return original;
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  if (changed && normalized !== original) {
    const boundaries = [...new Set(spans.flat())].sort((a, b) => a - b);
    const mapped = new Map(); let source = 0, position = 0, index = 0, m;
    RE_NORMALIZE.lastIndex = 0;
    while ((m = RE_NORMALIZE.exec(original)) !== null) {
      const next = position + m.index - source;
      while (index < boundaries.length && boundaries[index] <= next) {
        mapped.set(boundaries[index], source + boundaries[index] - position); index++;
      }
      position = next + (m[0][0] === '%' ? 1 : 0);
      source = RE_NORMALIZE.lastIndex;
    }
    while (index < boundaries.length) { mapped.set(boundaries[index], source + boundaries[index] - position); index++; }
    for (const span of spans) { span[0] = mapped.get(span[0]); span[1] = mapped.get(span[1]); }
  }
  let result = '', cursor = 0;
  for (const [start, end] of spans) {
    if (start < cursor) { cursor = Math.max(cursor, end); continue; }
    result += original.slice(cursor, start) + '[REDACTED]'; cursor = end;
  }
  return result + original.slice(cursor);
}

const DEFAULT_MAX_LENGTH = 200;

export function redactText(text, { maxLength = DEFAULT_MAX_LENGTH } = {}) {
  if (typeof text !== 'string') return null;
  let s = stripControls(text);
  s = maskEncodedCredentials(s).replace(RE_FORMAT, '');
  if (s.includes('://')) s = s.replace(RE_URL, '[URL]');
  s = s.replace(RE_WIN_UNC_PATH, '[PATH]');
  s = s.replace(RE_POSIX_PATH, '[PATH]');
  if (/@[A-Za-z0-9-]+\.[A-Za-z]{2}/.test(s)) s = s.replace(RE_EMAIL, '[EMAIL]');
  s = s.replace(RE_IPV4, '[IP]');
  s = s.replace(RE_BEARER, 'Bearer [TOKEN]');
  s = s.replace(RE_JWT, '[TOKEN]');
  s = s.replace(RE_PAIR, (m, q1, name, suffix, q2, sep) => {
    if (q1 !== q2) return m; // asymmetric quotes: not a clean pair, leave it
    return `${name}${suffix}=[MASKED]`;
  });
  s = s.replace(RE_CREDENTIAL, '[REDACTED]');
  s = s.replace(RE_OPAQUE, '[REDACTED]');
  if (s.length > maxLength) s = `${s.slice(0, maxLength)}...`;
  return s;
}
