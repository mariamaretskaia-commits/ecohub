/**
 * Детектор ссылок (порт из app/services/link_detector.py ecohub-trust).
 * Регэкспы + whitelist доменов + маскирование ненадёжных ссылок.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WHITELIST_PATH = path.join(__dirname, 'data', 'domain_whitelist.json');

const URL_RE = /https?:\/\/[^\s<>\[\]]+/gi;
const WWW_RE = /(?<![\w@])www\.[^\s<>\[\]]+/gi;
const TME_RE = /(?<![\w@])(?:https?:\/\/)?t\.me\/(?:s\/)?[a-z0-9_+]+/gi;
const SHORTENER_RE =
  /(?<![\w@])(bit\.ly|goo\.gl|t\.co|clck\.ru|tinyurl\.com|vk\.cc|is\.gd|cutt\.ly|rb\.gy|cas\.cm|tiny\.cc)\/[a-z0-9_.\-?=/&%]+/gi;
const BARE_DOMAIN_RE =
  /(?<![\w@])([a-z0-9-]+\.(?:ru|com|by|net|org|top|site|info|io))(?:\/[^\s<>\[\]]*)?/gi;

const KNOWN_SHORTENERS = new Set([
  'bit.ly', 'goo.gl', 't.co', 'clck.ru', 'tinyurl.com',
  'vk.cc', 'is.gd', 'cutt.ly', 'rb.gy', 'cas.cm', 'tiny.cc',
]);

let whitelistCache = null;

export function loadWhitelist() {
  if (whitelistCache) return whitelistCache;
  whitelistCache = JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf8'));
  return whitelistCache;
}

export class Link {
  constructor({ raw, url, domain, isShort = false, shortener = null }) {
    this.raw = raw;
    this.url = url;
    this.domain = domain;
    this.isShort = isShort;
    this.shortener = shortener;
  }
}

function cleanUrl(raw) {
  let u = String(raw).trim().replace(/[.,;!?)\]}]+$/, '');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  return u;
}

function rootDomain(host) {
  let h = String(host || '').toLowerCase().split(':')[0];
  if (h.startsWith('www.')) h = h.slice(4);
  return h;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function detectLinks(text) {
  const t = String(text || '');
  const found = [];
  const spanLookup = []; // [start, end, link] по возрастанию
  const push = (start, end, link) => {
    if (found.some((l) => l.link.raw === link.raw)) return;
    found.push({ start, end, link });
  };

  for (const m of t.matchAll(URL_RE)) {
    const raw = m[0];
    const url = cleanUrl(raw);
    const host = hostOf(url);
    const domain = rootDomain(host);
    const isShort = KNOWN_SHORTENERS.has(domain);
    push(m.index, m.index + raw.length, new Link({
      raw, url, domain, isShort,
      shortener: isShort ? domain : null,
    }));
  }
  for (const m of t.matchAll(TME_RE)) {
    const raw = m[0];
    const url = cleanUrl(raw);
    const domain = rootDomain(hostOf(url));
    push(m.index, m.index + raw.length, new Link({ raw, url, domain, isShort: false }));
  }
  for (const m of t.matchAll(SHORTENER_RE)) {
    const raw = m[0];
    const url = cleanUrl(raw);
    const domain = KNOWN_SHORTENERS.has(raw.split('/')[0].toLowerCase()) ? raw.split('/')[0].toLowerCase() : rootDomain(hostOf(url));
    push(m.index, m.index + raw.length, new Link({ raw, url, domain, isShort: true, shortener: domain }));
  }
  for (const m of t.matchAll(WWW_RE)) {
    const raw = m[0];
    const url = cleanUrl(raw);
    const domain = rootDomain(hostOf(url));
    push(m.index, m.index + raw.length, new Link({ raw, url, domain, isShort: false }));
  }
  for (const m of t.matchAll(BARE_DOMAIN_RE)) {
    const raw = m[0];
    const domain = m[1].toLowerCase();
    if (KNOWN_SHORTENERS.has(domain)) continue;
    const url = cleanUrl(raw);
    push(m.index, m.index + raw.length, new Link({ raw, url, domain, isShort: false }));
  }

  // убираем вложенные дубли по диапазонам: оставляем внешнюю ссылку
  spanLookup.splice(0, spanLookup.length, ...found);
  spanLookup.sort((a, b) => a.start - b.start);
  const result = [];
  for (const f of spanLookup) {
    const inner = spanLookup.some((g) => g.start >= f.start && g.end <= f.end && g !== f);
    if (!inner) result.push(f.link);
  }
  return result;
}

export function isAllowed(domain, whitelist) {
  const d = String(domain || '').toLowerCase();
  const direct = whitelist[d];
  if (direct) return direct.allow_subdomains !== false;
  const parts = d.split('.');
  for (let i = 1; i < parts.length - 1; i += 1) {
    const parent = parts.slice(i).join('.');
    const cfg = whitelist[parent];
    if (cfg && cfg.allow_subdomains !== false) return true;
  }
  return false;
}

export function checkLinks(links) {
  const whitelist = loadWhitelist();
  const allowed = [];
  const hidden = [];
  for (const link of links) {
    if (isAllowed(link.domain, whitelist)) allowed.push(link);
    else hidden.push(link);
  }
  return { allowed, hidden };
}

export function maskLinks(text, hiddenLinks) {
  const t = String(text || '');
  let count = 0;
  let out = t;
  for (const link of hiddenLinks) {
    if (!link.raw) continue;
    out = out.split(link.raw).join('[ссылка скрыта]');
    count += 1;
  }
  if (count) out = out.replace(/\s*\[ссылка скрыта\]/g, ' [ссылка скрыта]').replace(/\s+/g, ' ');
  return { censored: out, count };
}