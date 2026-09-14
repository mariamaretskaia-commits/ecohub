/**
 * Текстовый фильтр (порт из app/services/text_filter.py ecohub-trust).
 *
 * Четыре «холста» деобфускации:
 *   n  — map (leet-цифры + lookalike латиница -> кириллица, toLowerCase)
 *   t  — tight: удалены все не-алфанум символы (склейка, включая пробелы)
 *   t2 — squeeze: удалены только символы-разделители, пробелы сохранены
 *   d/d2 — dedup (повторы букв -> одна) для t и t2
 *
 * Поиск: каждая форма слова ищется против соответствующего холста
 * с проверкой границ слова. Покрывает leet, точки/разделители, дубли букв,
 * пробел-обфускацию и смену регистра.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOCAB_PATH = path.join(__dirname, 'data', 'banned_words.json');

const LEET = { 0: 'о', 1: 'л', 3: 'е', 4: 'а', 6: 'б', 7: 'т', 8: 'б' };
const LOOKALIKE = {
  a: 'а', o: 'о', e: 'е', c: 'с', x: 'х', p: 'р', y: 'у', k: 'к',
  m: 'м', t: 'т', i: 'и', h: 'н', b: 'в',
};

const SEPARATOR_RE = /[^a-zа-яё0-9]+/gu;
const SQUEEZE_RE = /[^\p{L}\p{N}_\s]+/gu;
const DEDUP_RE = /(.)\1+/g;
const ALT_RE = /\p{L}\p{M}*|\p{N}/u;

let vocabCache = null;

export function loadVocab() {
  if (vocabCache) return vocabCache;
  vocabCache = JSON.parse(fs.readFileSync(VOCAB_PATH, 'utf8'));
  return vocabCache;
}

export function _map(text) {
  let out = '';
  for (const ch of String(text).toLocaleLowerCase('ru')) {
    if (LEET[ch] !== undefined) out += LEET[ch];
    else if (LOOKALIKE[ch] !== undefined) out += LOOKALIKE[ch];
    else out += ch;
  }
  return out;
}

export function _tight(text) {
  return _map(text).replace(SEPARATOR_RE, '');
}

export function _squeeze(text) {
  return _map(text).replace(SQUEEZE_RE, '');
}

export function _dedup(text) {
  return text.replace(DEDUP_RE, '$1');
}

export function _isWordChar(ch) {
  return ALT_RE.test(ch);
}

function _boundaryOk(canvas, start, end) {
  if (start > 0 && _isWordChar(canvas[start - 1])) return false;
  if (end < canvas.length && _isWordChar(canvas[end])) return false;
  return true;
}

function _find(canvas, variant) {
  let idx = 0;
  while (idx <= canvas.length - variant.length) {
    const pos = canvas.indexOf(variant, idx);
    if (pos === -1) return null;
    if (_boundaryOk(canvas, pos, pos + variant.length)) return pos;
    idx = pos + 1;
  }
  return null;
}

function _wordVariants(word) {
  const n = _map(word);
  const t = _tight(n);
  const t2 = _squeeze(n);
  const d = _dedup(t);
  const d2 = _dedup(t2);
  return [
    ['n', n], ['t', t], ['t2', t2], ['d', d], ['d2', d2],
  ];
}

function _phraseVariants(phrase) {
  return [
    ['n', _map(phrase)],
    ['t', _tight(phrase)],
  ];
}

function _sectionType(section) {
  if (section === 'payment_triggers') return 'fraud';
  if (section === 'phishing_patterns') return 'phishing';
  return section; // drugs | weapons | documents
}

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };

export function _severityRank(s) {
  return SEVERITY_RANK[s] || 1;
}

export class ModerationResult {
  constructor() {
    this.flagged = false;
    this.type = 'clean';
    this.matched = [];
    this.severity = 'low';
    this.category = null;
    this.source = 'filter';
  }
}

export function checkText(text) {
  const vocab = loadVocab();
  const canvasN = _map(text);
  const canvasT = _tight(canvasN);
  const canvasT2 = _squeeze(canvasN);
  const canvasD = _dedup(canvasT);
  const canvasD2 = _dedup(canvasT2);
  const canvases = { n: canvasN, t: canvasT, t2: canvasT2, d: canvasD, d2: canvasD2 };

  const res = new ModerationResult();
  const matched = new Set();

  for (const [section, cfg] of Object.entries(vocab)) {
    const sev = cfg.severity || 'low';
    const type = _sectionType(section);
    const consider = (kind, variant) => {
      const pos = _find(canvases[kind], variant);
      if (pos === null) return;
      const term = variant;
      if (matched.has(term)) return;
      matched.add(term);
      res.flagged = true;
      res.matched.push(term);
      if (_severityRank(sev) > _severityRank(res.severity)) {
        res.severity = sev;
        res.type = type;
        res.category = section;
      }
    };
    for (const word of cfg.words || []) {
      for (const [kind, variant] of _wordVariants(word)) consider(kind, variant);
    }
    for (const phrase of cfg.phrases || []) {
      for (const [kind, variant] of _phraseVariants(phrase)) consider(kind, variant);
    }
  }

  if (!res.flagged) res.type = 'clean';
  return res;
}

export function checkMessageForFraud(text, { firstMessage = false, hasLink = false, hasUntrustedLink = null } = {}) {
  const res = checkText(text);
  if (!res.flagged) return res;
  const onlyFraud = res.type === 'fraud' || res.type === 'phishing';
  const suspiciousLink = hasUntrustedLink !== null ? hasUntrustedLink : hasLink;
  if (onlyFraud && (suspiciousLink || firstMessage)) {
    if (_severityRank(res.severity) < _severityRank('high')) res.severity = 'high';
  }
  return res;
}

export function censorText(text) {
  const res = checkText(text);
  if (!res.flagged) return { censored: String(text), count: 0 };
  const lower = String(text).toLowerCase();
  const spans = [];
  const seen = new Set();
  for (const term of res.matched) {
    const variants = new Set([term.toLocaleLowerCase('ru'), _map(term)]);
    for (const variant of variants) {
      if (!variant || seen.has(variant)) continue;
      seen.add(variant);
      let idx = 0;
      while (idx <= lower.length - variant.length) {
        const pos = lower.indexOf(variant, idx);
        if (pos === -1) break;
        if (_boundaryOk(lower, pos, pos + variant.length)) spans.push([pos, pos + variant.length]);
        idx = pos + 1;
      }
    }
  }
  if (!spans.length) return { censored: String(text), count: 0 };
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of spans) {
    if (merged.length && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else {
      merged.push([s, e]);
    }
  }
  let out = '';
  let cursor = 0;
  for (const [s, e] of merged) {
    out += text.slice(cursor, s) + '[***]';
    cursor = e;
  }
  out += text.slice(cursor);
  return { censored: out, count: merged.length };
}