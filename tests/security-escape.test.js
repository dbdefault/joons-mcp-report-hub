import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, escapeXml, escapeMarkdown } from '../src/security/escape.js';

const SCRIPT = '<script>alert(1)</script>';
const SCRIPT_ESCAPED = '&lt;script&gt;alert(1)&lt;/script&gt;';

test('escapeHtml neutralises script tags', () => {
  assert.equal(escapeHtml(SCRIPT), SCRIPT_ESCAPED);
});

test('escapeHtml neutralises attribute-breakout payloads', () => {
  assert.equal(escapeHtml('"onload='), '&quot;onload=');
  assert.equal(escapeHtml('</script>'), '&lt;/script&gt;');
  assert.equal(escapeHtml(']]>'), ']]&gt;');
  assert.equal(escapeHtml("x' y\" z`"), 'x&#39; y&quot; z&#96;');
});

test('escapeHtml double-escapes pre-escaped entities (no raw pass-through)', () => {
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  assert.equal(escapeHtml('&amp;'), '&amp;amp;');
  assert.equal(escapeHtml('&quot;onload='), '&amp;quot;onload=');
});

test('escapeHtml strips bidi, ANSI and C1 payloads', () => {
  assert.equal(escapeHtml('a\u202ab\u202bc'), 'abc');
  assert.equal(escapeHtml('\x1b[31mred\x1b[0m'), 'red');
  assert.equal(escapeHtml('x\u007fy\u009f'), 'xy');
  assert.equal(escapeHtml('e\u0301'), 'e\u0301'); // combining marks survive
});

test('escapeXml escapes the five XML specials', () => {
  assert.equal(escapeXml(SCRIPT), SCRIPT_ESCAPED.replace(/&#39;/g, '&apos;'));
  assert.equal(escapeXml('"onload='), '&quot;onload=');
  assert.equal(escapeXml(']]>'), ']]&gt;');
  assert.equal(escapeXml("a'b"), 'a&apos;b');
  assert.equal(escapeXml('&lt;'), '&amp;lt;');
  assert.equal(escapeXml('a`b'), 'a`b'); // backtick is not special in XML
});

test('escapeMarkdown escapes table/format specials', () => {
  assert.equal(escapeMarkdown('|a|b|'), '\\|a\\|b\\|');
  assert.equal(escapeMarkdown('`code`'), '\\`code\\`');
  assert.equal(escapeMarkdown('*em* _x_'), '\\*em\\* \\_x\\_');
  assert.equal(escapeMarkdown('[label](https://example.invalid)'), '\\[label\\](https://example.invalid)');
  assert.equal(escapeMarkdown('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
});

test('escapeMarkdown flattens newlines and tabs to spaces', () => {
  assert.equal(escapeMarkdown('a\nb'), 'a b');
  assert.equal(escapeMarkdown('a\r\nb'), 'a b');
  assert.equal(escapeMarkdown('a\tb'), 'a b');
});

test('escapeMarkdown strips controls before escaping', () => {
  assert.equal(escapeMarkdown('\x1b[31m*red*\x1b[0m'), '\\*red\\*');
  assert.equal(escapeMarkdown('a\u2028b|c'), 'ab\\|c');
});

test('escapers coerce non-string input', () => {
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeXml(null), 'null');
  assert.equal(escapeMarkdown(true), 'true');
});
