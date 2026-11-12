// src/input/read.js - INPUT owner. Safe file read + bounded JSON parse.
import fs from 'node:fs';
import { isPlainObject, hasOwn } from '../util/object.js';

export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024; // 8 MiB
export const DEFAULT_MAX_DEPTH = 64;
export const DEFAULT_MAX_NODES = 500000;
export const DEFAULT_MAX_STRING_LENGTH = 100000;

const KIND_MESSAGES = {
  file_not_found: 'input file not found',
  file_too_large: 'input file too large',
  read_failed: 'cannot read input file',
  invalid_utf8: 'input is not valid UTF-8',
  depth_exceeded: 'JSON nesting too deep',
  limit_exceeded: 'JSON structure exceeds limits',
};

export class InputError extends Error {
  constructor(kind, message) {
    super(message || KIND_MESSAGES[kind] || 'invalid input');
    this.name = 'InputError';
    this.kind = kind;
  }
}

// Reads a report file: stat BEFORE read (size limit), fatal UTF-8 decode,
// exactly one BOM stripped. Messages never contain the path or content.
export function readReportFile(path, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  let st;
  try {
    st = fs.statSync(path);
  } catch (err) {
    if (err && err.code === 'ENOENT') throw new InputError('file_not_found');
    throw new InputError('read_failed');
  }
  if (!st.isFile()) throw new InputError('read_failed');
  if (st.size > maxBytes) throw new InputError('file_too_large');

  let bytes;
  try {
    bytes = fs.readFileSync(path);
  } catch {
    throw new InputError('read_failed');
  }
  if (bytes.length > maxBytes) throw new InputError('file_too_large');

  let view = bytes;
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  ) {
    view = bytes.subarray(3); // exactly one BOM
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(view);
  } catch {
    throw new InputError('invalid_utf8');
  }
  return { bytes, text };
}

// Find the line/column of a JSON syntax error. Newer V8 messages carry
// "at position N"; truncated input reports "Unexpected end"; plain token
// errors carry no position, so locate it by binary search over prefixes:
// a prefix whose failure is reported AT its own end is a truncation
// artifact, anything else means the first real error is before that prefix.
function errorPosition(text, err) {
  const direct = /at position (\d+)/.exec(err.message);
  if (direct) return offsetToLineColumn(text, Number(direct[1]));
  if (/Unexpected end of JSON input/.test(err.message)) {
    return offsetToLineColumn(text, text.length);
  }
  let lo = 1;
  let hi = text.length;
  let answer = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let realError = false;
    try {
      JSON.parse(text.slice(0, mid));
    } catch (e) {
      const pm = /at position (\d+)/.exec(e.message);
      realError = pm ? Number(pm[1]) < mid : !/Unexpected end of JSON input/.test(e.message);
    }
    if (realError) {
      answer = mid - 1;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  if (answer < 0) return offsetToLineColumn(text, text.length);
  return offsetToLineColumn(text, answer);
}

function offsetToLineColumn(text, pos) {
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < pos && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 0x0a) {
      line += 1;
      lastNl = i;
    }
  }
  return { line, column: pos - lastNl };
}

// Iterative walk (explicit stack - no recursion, no stack overflow) enforcing
// maxDepth, maxNodes and per-string/per-key length limits.
function walkLimits(value, maxDepth, maxNodes, maxStringLength) {
  let nodes = 0;
  const stack = [{ v: value, d: 1 }];
  while (stack.length > 0) {
    const { v, d } = stack.pop();
    nodes += 1;
    if (nodes > maxNodes) throw new InputError('limit_exceeded');
    if (typeof v === 'string') {
      if (v.length > maxStringLength) throw new InputError('limit_exceeded');
      continue;
    }
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) continue;
    if (Array.isArray(v)) {
      if (d > maxDepth) throw new InputError('depth_exceeded');
      for (let i = 0; i < v.length; i += 1) stack.push({ v: v[i], d: d + 1 });
      continue;
    }
    if (isPlainObject(v)) {
      if (d > maxDepth) throw new InputError('depth_exceeded');
      for (const key of Object.keys(v)) {
        if (key.length > maxStringLength) throw new InputError('limit_exceeded');
        if (hasOwn(v, key)) stack.push({ v: v[key], d: d + 1 });
      }
    }
    // other types cannot occur in JSON.parse output
  }
}

export function parseJsonText(
  text,
  {
    maxDepth = DEFAULT_MAX_DEPTH,
    maxNodes = DEFAULT_MAX_NODES,
    maxStringLength = DEFAULT_MAX_STRING_LENGTH,
  } = {},
) {
  let s = String(text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // at most one BOM
  let value;
  try {
    value = JSON.parse(s);
  } catch (err) {
    if (err instanceof RangeError) {
      // native parser recursion limit - report through our own depth limit
      throw new InputError('depth_exceeded');
    }
    if (err instanceof SyntaxError) {
      const { line, column } = errorPosition(s, err);
      throw new InputError('invalid_json', `line ${line} column ${column}`);
    }
    throw err;
  }
  walkLimits(value, maxDepth, maxNodes, maxStringLength);
  return value;
}
