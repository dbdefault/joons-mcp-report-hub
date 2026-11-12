// src/security/escape.js - INPUT owner. Output-escaping helpers.
import { stripControls } from '../util/object.js';

// All escapers strip controls FIRST (with keepNewlines so that escapeMarkdown
// can then normalise newlines itself).

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

const XML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

const MD_ESCAPES = {
  '|': '\\|',
  '`': '\\`',
  '*': '\\*',
  '_': '\\_',
  '[': '\\[',
  ']': '\\]',
  '<': '&lt;',
  '>': '&gt;',
};

export function escapeHtml(text) {
  return stripControls(text, { keepNewlines: true }).replace(
    /[&<>"'`]/g,
    (ch) => HTML_ESCAPES[ch],
  );
}

export function escapeXml(text) {
  return stripControls(text, { keepNewlines: true }).replace(
    /[&<>"']/g,
    (ch) => XML_ESCAPES[ch],
  );
}

// Markdown (table-safe): specials escaped, remaining \n / \t become spaces.
export function escapeMarkdown(text) {
  return stripControls(text, { keepNewlines: true })
    .replace(/[\n\t]/g, ' ')
    .replace(/[|`_*[\]<>]/g, (ch) => MD_ESCAPES[ch]);
}
