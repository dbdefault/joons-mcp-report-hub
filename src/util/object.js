// src/util/object.js - INPUT owner. Object safety helpers.
import { createHash } from 'node:crypto';

const OBJECT_PROTO = Object.prototype;

// True only for objects whose prototype is Object.prototype or null
// (rejects arrays, class instances, cross-realm objects, functions).
export function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  let proto;
  try {
    proto = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return proto === OBJECT_PROTO || proto === null;
}

export function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

const SAFE_KEY_RE = /^[A-Za-z0-9_$.-]{1,64}$/;

// Show an untrusted JSON key only when it is a safe printable token;
// otherwise a stable placeholder with the key's index (never the content).
export function safePathSegment(key, index) {
  if (Number.isSafeInteger(key) && key >= 0) return String(key);
  if (typeof key === 'string' && SAFE_KEY_RE.test(key)) return key;
  const n = Number.isInteger(index) && index >= 0 ? index : 0;
  return `<unknown key #${n}>`;
}

// Linear O(n) removal of ANSI/ECMA-48 escape sequences:
// CSI "ESC [ params intermediates final", OSC "ESC ] ... (BEL | ESC \)",
// and two-byte "ESC Fe" sequences. Unterminated OSC is consumed to end.
function removeEscapeSequences(s) {
  let start = 0;
  let out = '';
  const n = s.length;
  while (true) {
    const esc = s.indexOf('\x1b', start);
    if (esc === -1) {
      out += s.slice(start);
      break;
    }
    out += s.slice(start, esc);
    let i = esc + 1; // drop ESC
    if (i >= n) {
      start = i;
      break;
    }
    const c1 = s.charCodeAt(i);
    if (c1 === 0x5b) {
      // CSI
      i += 1;
      while (i < n) {
        const k = s.charCodeAt(i);
        if ((k >= 0x30 && k <= 0x3f) || (k >= 0x20 && k <= 0x2f)) {
          i += 1;
          continue;
        }
        if (k >= 0x40 && k <= 0x7e) i += 1;
        break;
      }
    } else if (c1 === 0x5d) {
      // OSC
      i += 1;
      while (i < n && s.charCodeAt(i) !== 0x07 && s.charCodeAt(i) !== 0x1b) i += 1;
      if (i < n && s.charCodeAt(i) === 0x07) {
        i += 1;
      } else if (i + 1 < n && s.charCodeAt(i + 1) === 0x5c) {
        i += 2;
      } else if (i < n) {
        i += 1; // lone ESC inside OSC: drop it, keep scanning
      }
    } else if (c1 >= 0x40 && c1 <= 0x5f) {
      i += 1; // Fe final byte
    }
    // otherwise: lone ESC before an ordinary char - drop the ESC only
    start = i;
  }
  return out;
}

// Control characters removed by stripControls (single regex, no backtracking):
// C0, DEL, C1, bidi/format controls, U+2028/2029. \n and \t survive only
// when keepNewlines is true. ESC itself is handled by removeEscapeSequences.
const CONTROLS_ALWAYS =
  '\\u0000-\\u0008\\u000b-\\u000c\\u000d\\u000e-\\u001f\\u007f-\\u009f' +
  '\\u061c\\u200e\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069';
const RE_CONTROLS_STRICT = new RegExp(`[\\u0009\\u000a${CONTROLS_ALWAYS}]`, 'g');
const RE_CONTROLS_KEEP_NL = new RegExp(`[${CONTROLS_ALWAYS}]`, 'g');

export function stripControls(text, { keepNewlines = false } = {}) {
  const s = removeEscapeSequences(String(text));
  return s.replace(keepNewlines ? RE_CONTROLS_KEEP_NL : RE_CONTROLS_STRICT, '');
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
