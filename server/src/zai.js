/**
 * Минимальный OpenAI-совместимый клиент для Zhipu / z.ai (GLM).
 * Используется категоризацией вещей (categorize.js) и ИИ-модератором (trust/ai.js).
 */

const DEFAULT_URL = 'https://api.z.ai/api/paas/v4/chat/completions';

export function zhipuKey() {
  return String(process.env.ZHIPU_API_KEY || '').trim() || null;
}

export function zhipuTextModel() {
  return String(process.env.ZHIPU_TEXT_MODEL || 'glm-4-flash').trim();
}

export function zhipuVisionModel() {
  return String(process.env.ZHIPU_VISION_MODEL || 'glm-4.6v-flash').trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Достаёт JSON из ответа модели (устойчив к markdown-обёрткам и лишнему тексту). */
export function parseJsonEnvelope(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const braceStart = t.indexOf('{');
  const braceEnd = t.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(t.slice(braceStart, braceEnd + 1));
    } catch {
      /* fall through */
    }
  }
  const arrStart = t.indexOf('[');
  const arrEnd = t.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      return JSON.parse(t.slice(arrStart, arrEnd + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Вызов Zhipu chat completions (текстовая или мультимодальная подпись).
 * @param {Array} messages  — массив сообщений OpenAI-формата (content может быть строкой или массивом)
 * @returns {Promise<{ok:boolean, content?:string, status?:number, error?:string}>}
 */
export async function zhipuChat(messages, opts = {}) {
  const key = opts.apiKey || zhipuKey();
  if (!key) return { ok: false, error: 'no_key' };
  const url = opts.url || process.env.ZHIPU_TEXT_URL || DEFAULT_URL;
  const model = opts.model || zhipuTextModel();
  const timeoutMs = opts.timeoutMs ?? 20000;
  const retries = Math.max(0, opts.retries ?? 1);
  const doFetch = opts.fetchImpl || globalThis.fetch;

  const payload = {
    model,
    messages,
    temperature: opts.temperature ?? 0,
    ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
  };

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let ctrl = null;
    try {
      ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let resp;
      try {
        resp = await doFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
            ...(opts.headers || {}),
          },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!resp) return { ok: false, error: 'no_response' };
      if (resp.status === 401 || resp.status === 403) return { ok: false, status: resp.status, error: 'auth' };
      if (resp.status === 429 || resp.status >= 500) {
        lastError = `http_${resp.status}`;
        if (attempt < retries) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        return { ok: false, status: resp.status, error: lastError };
      }
      if (resp.status < 200 || resp.status >= 300) {
        return { ok: false, status: resp.status, error: `http_${resp.status}` };
      }
      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return { ok: false, error: 'malformed' };
      return { ok: true, content };
    } catch (err) {
      lastError = String(err?.message || err);
      if (attempt < retries) {
        await sleep(800 * (attempt + 1));
        continue;
      }
    }
  }
  return { ok: false, error: lastError || 'unavailable' };
}

/** Удобная обёртка для однократного текстового запроса с JSON-ответом. */
export async function zhipuJsonChat(systemPrompt, userText, opts = {}) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  if (userText) messages.push({ role: 'user', content: userText });
  const res = await zhipuChat(messages, opts);
  if (!res.ok) return { ok: false, error: res.error, status: res.status };
  return { ok: true, value: parseJsonEnvelope(res.content), raw: res.content };
}