/**
 * AI-модерация через OpenAI (порт из app/services/ai_moderation.py).
 * Node 18+ fetch, circuit breaker, degraded-режим без ключа.
 */

const AI_TEXT_TIMEOUT = 15000;
const AI_IMAGE_TIMEOUT = 25000;
const MAX_RETRIES = 2;
const BREAK_FAILURES = 3;
const BREAK_WINDOW_SEC = 300;

class _CircuitBreaker {
  constructor() {
    this.window = BREAK_WINDOW_SEC;
    this._openUntil = 0;
    this._consecutive = 0;
  }

  get degraded() {
    return Date.now() < this._openUntil;
  }

  reportSuccess() {
    this._consecutive = 0;
  }

  reportFailure() {
    this._consecutive += 1;
    if (this._consecutive >= BREAK_FAILURES) {
      this._openUntil = Date.now() + this.window * 1000;
      console.warn('[trust:ai] circuit breaker open for %ss', this.window);
      this._consecutive = 0;
    }
  }
}

const circuit = new _CircuitBreaker();

function aiEndpoints() {
  return {
    moderationUrl: process.env.OPENAI_MODERATION_URL || 'https://api.openai.com/v1/moderations',
    visionUrl: process.env.OPENAI_VISION_URL || 'https://api.openai.com/v1/chat/completions',
  };
}

export function aiAvailable() {
  return Boolean(process.env.OPENAI_API_KEY) && !circuit.degraded;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postJson(url, payload, token, timeout) {
  let delay = 1000;
  let last = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      let resp;
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (resp.status === 401) return { kind: 'disabled', error: 'invalid_api_key' };
      if (resp.status === 429) return { kind: 'ratelimit', error: 'rate_limit' };
      if (!resp.ok) {
        const err = new Error(`AI HTTP ${resp.status}`);
        last = err;
      } else {
        return { kind: 'ok', data: await resp.json() };
      }
    } catch (err) {
      last = err;
    }
    await sleep(delay);
    delay *= 2;
  }
  return { kind: 'error', error: last ? last.message : 'unavailable' };
}

export async function moderateText(text, retries = 1) {
  const result = { flagged: false, categories: [], confidence: 0, skipped: false, error: null };
  if (!text) return result;
  if (!process.env.OPENAI_API_KEY || circuit.degraded) {
    result.skipped = true;
    return result;
  }
  const { moderationUrl } = aiEndpoints();
  const payload = { model: 'text-moderation-latest', input: text };
  const attempts = Math.max(1, retries + 1);
  for (let a = 0; a < attempts; a += 1) {
    const r = await postJson(moderationUrl, payload, process.env.OPENAI_API_KEY, AI_TEXT_TIMEOUT);
    if (r.kind === 'disabled') {
      circuit.reportFailure();
      result.error = 'invalid_api_key';
      break;
    }
    if (r.kind === 'ratelimit' || r.kind === 'error') {
      circuit.reportFailure();
      result.error = result.error || r.error;
      continue;
    }
    circuit.reportSuccess();
    try {
      const item = r.data.results[0];
      result.categories = Object.keys(item.categories || {}).filter((k) => item.categories[k]);
      result.flagged = Boolean(item.flagged) || result.categories.length > 0;
      result.confidence = result.categories.length ? Number(item.category_scores?.[result.categories[0]] || 0) : 0;
    } catch {
      result.error = 'malformed_response';
    }
    return result;
  }
  result.skipped = true;
  result.error = result.error || 'unavailable';
  return result;
}

export async function moderateImage(imageRef, retries = 1) {
  const result = { safe: true, category: null, confidence: 0, skipped: false, error: null };
  if (!imageRef) return result;
  if (!process.env.OPENAI_API_KEY || circuit.degraded) {
    result.skipped = true;
    return result;
  }
  const { visionUrl } = aiEndpoints();
  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageRef } },
          {
            type: 'text',
            text: 'Это изображение для модерации приложения безвозмездного обмена вещами. ' +
              'Ответь ТОЛЬКО валидным JSON формата ' +
              '{"safe": true/false, "category": "drugs"|"weapons"|"documents"|"fraud"|"phishing"|null, ' +
              '"confidence": 0.0-1.0}. Запрещены: наркотики, оружие, поддельные документы, ' +
              'платёжные данные и инструкции по оплате.',
          },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 120,
  };
  const attempts = Math.max(1, retries + 1);
  for (let a = 0; a < attempts; a += 1) {
    const r = await postJson(visionUrl, payload, process.env.OPENAI_API_KEY, AI_IMAGE_TIMEOUT);
    if (r.kind === 'disabled') {
      circuit.reportFailure();
      result.error = 'invalid_api_key';
      break;
    }
    if (r.kind === 'ratelimit' || r.kind === 'error') {
      circuit.reportFailure();
      result.error = result.error || r.error;
      continue;
    }
    circuit.reportSuccess();
    try {
      const text = r.data.choices[0].message.content;
      const cleaned = String(text).trim().replace(/^`+/, '').replace(/`+$/, '').replace(/^json/i, '').trim();
      const parsed = JSON.parse(cleaned);
      result.safe = Boolean(parsed.safe ?? true);
      result.category = parsed.category || null;
      result.confidence = Number(parsed.confidence || 0);
    } catch {
      result.error = 'malformed_response';
    }
    return result;
  }
  result.skipped = true;
  result.error = result.error || 'unavailable';
  return result;
}