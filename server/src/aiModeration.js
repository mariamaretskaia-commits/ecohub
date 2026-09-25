/**
 * ИИ-модерация контента EcoHub.
 *
 * Цепочка провайдеров:
 *   1) NVIDIA Nemotron 3.5 Content Safety (OpenRouter, бесплатная модель) — основной;
 *   2) OpenAI omni-moderation-latest — резерв (эндпоинт /v1/moderations, текст+картинка);
 *   3) Zhipu GLM (trust/ai.js) — последний ИИ-запасной;
 *   4) недоступны все ИИ → { available:false } → вызывающий код публикует с меткой
 *      pending_ai_review (словарный фильтр уже отработал первым слоем в pipeline.js).
 *
 * Жёсткий лимит времени: не ждём провайдера дольше таймаута, суммарный бюджет —
 * задаётся AI_MODERATION_BUDGET_MS (по умолчанию 2800 мс), чтобы публикация
 * не блокировалась дольше ~2–3 секунд.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseJsonEnvelope } from './zai.js';
import { moderateText as zhipuText, moderateImage as zhipuImage } from './trust/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_MODEL = 'nvidia/nemotron-3.5-content-safety:free';
const DEFAULT_OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENAI_MODERATION_URL = 'https://api.openai.com/v1/moderations';

const BREAK_FAILURES = 3;
const BREAK_WINDOW_SEC = 300;

const HARD_CATEGORIES = /^(drugs|narcotics|weapons|documents|forged_documents|fraud|payment_solicit|money|phishing)$/i;

export function openRouterKey() {
  return String(process.env.OPENROUTER_API_KEY || '').trim() || null;
}
export function openRouterModel() {
  return String(process.env.OPENROUTER_MODEL || DEFAULT_MODEL).trim();
}
function openAiKey() {
  return String(process.env.OPENAI_API_KEY || '').trim() || null;
}
export function aiModerationBudgetMs() {
  const n = Number(process.env.AI_MODERATION_BUDGET_MS);
  return Number.isFinite(n) && n > 0 ? n : 2800;
}
function aiTimeoutMs() {
  const n = Number(process.env.AI_MODERATION_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 2500;
}
function reasoningDisabled() {
  return String(process.env.OPENROUTER_DISABLE_REASONING || '1') !== '0';
}

// ─── circuit breaker (общий на сетевые вызовы) ───────────────────────────────
class _CircuitBreaker {
  constructor() {
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
      this._openUntil = Date.now() + BREAK_WINDOW_SEC * 1000;
      this._consecutive = 0;
      console.warn('[aiModeration] circuit breaker open for %ss', BREAK_WINDOW_SEC);
    }
  }
}
const circuit = new _CircuitBreaker();

// Для тестов: подменяемый fetch.
let _fetch = typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined;
export function __setFetch(fn) {
  _fetch = fn || globalThis.fetch;
}
export function __resetForTests() {
  circuit._openUntil = 0;
  circuit._consecutive = 0;
  _fetch = globalThis.fetch;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const SYSTEM_PROMPT = [
  'Ты — модератор приложения EcoHub — сервиса безвозмездного обмена вещами в Республике Беларусь.',
  'Определи, содержит ли контент (объявление, сообщение или изображение) запрещённые товары или попытки обойти модерацию.',
  '',
  'Запрещено (block):',
  '- наркотики и психоактивные вещества (включая жаргон: «гера», «мяу», «соль», «спайс», «шишки», «трава» и т.п.), предложения продажи/передачи, оплата, переводы денег, платёжные данные;',
  '- оружие, боеприпасы, взрывчатые вещества;',
  '- поддельные документы;',
  '- любые коммерческие предложения за деньги в сервисе безвозмездного обмена.',
  '',
  'Требует ручной проверки (review):',
  '- подозрительный или неоднозначный контент, ссылки на внешние ресурсы, оскорбления, спам, массовые рассылки.',
  '',
  'Обращай особое внимание на обход модерации:',
  '- символы вместо букв: «%N@RкОТ%к», «к0к@ин», «S€x€», «н@ркотик» и т.п.;',
  '- транслит и микс языков: «токСЫЧ», «нарkотики», «drugs», «трава»;',
  '- эмодзи и визуальные намёки: 🍃 🌿 ❄️ 💉 и т.п.;',
  '- текст, нанесённый на фотографии.',
  '',
  'Ответь ТОЛЬКО валидным JSON без лишнего текста:',
  '{"flagged": true/false, "categories": ["..."], "action": "block"|"review"|"pass", "reasoning": "краткое объяснение"}',
  '- block — контент однозначно нарушает правила;',
  '- review — нужна ручная проверка;',
  '- pass — контент безопасен.',
  'Если ничего опасного нет: {"flagged": false, "categories": [], "action": "pass", "reasoning": "..."}',
].join('\n');

/**
 * Готовит ссылку на картинку для ИИ из данных объявления.
 * Принимает data:URI, http(s)-URL или относительный /uploads/.... путь.
 */
export function photoToAiRef(photoUrl) {
  if (!photoUrl) return null;
  const s = String(photoUrl);
  if (s.startsWith('data:') || s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('/uploads/')) {
    const file = path.join(__dirname, '..', 'data', 'uploads', path.basename(s));
    try {
      const buf = fs.readFileSync(file);
      const ext = path.extname(file).toLowerCase();
      const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'image/jpeg';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }
  return s;
}

/** Приводит аргумент imageBase64 (data-URI или голый base64) к data-URI. */
function normalizeImageRef(imageBase64) {
  if (!imageBase64) return null;
  const s = String(imageBase64).trim();
  if (!s) return null;
  if (s.startsWith('data:')) return s;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return `data:image/jpeg;base64,${s}`;
}

async function _postJson(url, payload, headers, timeoutMs, fetchImpl) {
  const ctrl = new AbortController();
  let timer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(Object.assign(new Error('AI timeout'), { code: 'ETIMEDOUT' }));
      }, timeoutMs);
    });
    const resp = await Promise.race([
      fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      }),
      timeoutPromise,
    ]);
    if (resp.status === 401 || resp.status === 403) return { kind: 'disabled', status: resp.status };
    if (resp.status === 429) return { kind: 'ratelimit', status: resp.status };
    if (resp.status < 200 || resp.status >= 300) return { kind: 'error', status: resp.status };
    try {
      const data = await resp.json();
      return { kind: 'ok', data };
    } catch {
      return { kind: 'malformed', status: resp.status };
    }
  } catch (err) {
    return { kind: err && err.code === 'ETIMEDOUT' ? 'timeout' : 'error', status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function _deriveAction(parsed) {
  if (!parsed || !parsed.flagged) return 'pass';
  const cats = Array.isArray(parsed.categories) ? parsed.categories.map(String) : [];
  const stated = parsed && typeof parsed.action === 'string' && ['block', 'review', 'pass'].includes(parsed.action)
    ? parsed.action
    : null;
  // Противоречие: flagged=true при action=pass — консервативно уводим в review.
  if (stated && stated !== 'pass') return stated;
  return cats.some((c) => HARD_CATEGORIES.test(c)) ? 'block' : 'review';
}

function _normalizeCategories(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (raw && typeof raw === 'object') {
    return Object.keys(raw).filter((k) => Boolean(raw[k]));
  }
  return [];
}

// ─── провайдеры ──────────────────────────────────────────────────────────────

async function _nemotron(text, imageRef, budgetMs, contentType = 'listing') {
  const key = openRouterKey();
  if (!key || circuit.degraded) return { skipped: true, reason: !key ? 'no_key' : 'degraded' };

  const label = contentType === 'message' ? 'сообщение в чате' : 'объявление';
  const contentHint = (text ? String(text).slice(0, 4000) : '—') + (imageRef ? `\n(приложено изображение)` : '');
  const payload = {
    model: openRouterModel(),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${label} для проверки:\n${contentHint}` },
          ...(imageRef ? [{ type: 'image_url', image_url: { url: imageRef } }] : []),
        ],
      },
    ],
    temperature: 0,
    max_tokens: 700,
  };
  if (reasoningDisabled()) payload.reasoning = { enabled: false };

  const timeoutMs = Math.min(aiTimeoutMs(), budgetMs);
  const fetchImpl = _fetch;

  const attempt = async (pl) => {
    const r = await _postJson(DEFAULT_OPENROUTER_URL, pl, { Authorization: `Bearer ${key}` }, timeoutMs, fetchImpl);
    if (r.kind === 'disabled') return { skipped: true, reason: 'auth' };
    if (r.kind !== 'ok') return { skipped: true, reason: r.kind, status: r.status };
    const content = r.data?.choices?.[0]?.message?.content;
    const parsed = parseJsonEnvelope(content);
    if (!parsed || typeof parsed !== 'object' || !('flagged' in parsed)) return { skipped: true, reason: 'malformed' };
    circuit.reportSuccess();
    return { skipped: false, parsed };
  };

  const first = await attempt(payload);
  if (first.skipped && first.reason === 'ratelimit' && reasoningDisabled()) {
    const { ...pl } = payload;
    delete pl.reasoning;
    await sleep(120);
    const second = await attempt(pl);
    if (!second.skipped) return second;
  }
  if (first.skipped) circuit.reportFailure();
  return first;
}

async function _omni(text, imageRef, budgetMs) {
  const key = openAiKey();
  if (!key || circuit.degraded) return { skipped: true, reason: !key ? 'no_key' : 'degraded' };

  const hasImage = Boolean(imageRef);
  const input = hasImage
    ? [{ type: 'image_url', image_url: { url: imageRef } }]
    : (text || '');
  const payload = {
    model: 'omni-moderation-latest',
    input,
    input_type: hasImage ? 'image' : 'text',
  };
  const timeoutMs = Math.min(1500, budgetMs);
  const r = await _postJson(
    process.env.OPENAI_MODERATION_URL || DEFAULT_OPENAI_MODERATION_URL,
    payload,
    { Authorization: `Bearer ${key}` },
    timeoutMs,
    _fetch,
  );
  if (r.kind === 'disabled') return { skipped: true, reason: 'auth' };
  if (r.kind !== 'ok') return { skipped: true, reason: r.kind, status: r.status };
  const item = r.data?.results?.[0];
  if (!item || !('flagged' in item)) return { skipped: true, reason: 'malformed' };
  circuit.reportSuccess();
  const parsed = {
    flagged: Boolean(item.flagged),
    categories: _normalizeCategories(item.categories || item.category_scores),
    action: item.flagged ? 'review' : 'pass',
    reasoning: item.flagged ? 'Помечено резервной модерацией OpenAI (omni-moderation).' : '',
  };
  return { skipped: false, parsed };
}

async function _zhipu(text, imageRef, budgetMs) {
  if (circuit.degraded) return { skipped: true, reason: 'degraded' };
  return _withBudget(async () => {
    if (imageRef) {
      const res = await zhipuImage(imageRef, 0);
      if (res.skipped) return { skipped: true, reason: res.error || 'zhipu_unavailable' };
      if (res.safe) return { skipped: false, parsed: { flagged: false, categories: [], action: 'pass', reasoning: '' } };
      return {
        skipped: false,
        parsed: {
          flagged: true,
          categories: [res.category || 'image_unsafe'],
          action: 'review',
          reasoning: 'Опасное содержимое на изображении (запасной ИИ-провайдер Zhipu).',
        },
      };
    }
    const res = await zhipuText(text || '', 1);
    if (res.skipped) return { skipped: true, reason: res.error || 'zhipu_unavailable' };
    if (!res.flagged) return { skipped: false, parsed: { flagged: false, categories: [], action: 'pass', reasoning: '' } };
    const cats = Array.isArray(res.categories) ? res.categories.map(String) : [];
    return {
      skipped: false,
      parsed: {
        flagged: true,
        categories: cats.length ? cats : ['ai_flag'],
        action: cats.some((c) => HARD_CATEGORIES.test(c)) ? 'block' : 'review',
        reasoning: 'Контент помечен запасным ИИ-провайдером (Zhipu).',
      },
    };
  }, Math.min(2000, budgetMs));
}

/** Промис с бюджетом времени: не ждём дольше ms (не прерывает сам вызов). */
function _withBudget(promiseFactory, ms) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve({ skipped: true, reason: 'timeout' });
      }
    }, Math.max(1, ms));
    promiseFactory().then((res) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(res);
      }
    }).catch((err) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ skipped: true, reason: err && err.message ? err.message : 'error' });
      }
    });
  });
}

/**
 * Единая точка ИИ-модерации контента.
 * @param {object} params
 * @param {string} [params.text]            – текст объявления/сообщения
 * @param {string} [params.imageBase64]     – data-URI или base64 изображения (первое фото)
 * @param {'listing'|'message'} [params.contentType]
 * @returns {Promise<{
 *   flagged: boolean,
 *   categories: string[],
 *   action: 'block'|'review'|'pass',
 *   reasoning: string,
 *   provider: string|null,
 *   available: boolean
 * }>}
 */
export async function moderateContent({ text, imageBase64, contentType = 'listing' } = {}) {
  const imageRef = normalizeImageRef(imageBase64);
  const budget = aiModerationBudgetMs();
  const startedAt = Date.now();
  let spent = () => Date.now() - startedAt;
  const remaining = (floor) => Math.max(floor || 0, budget - spent());

  const nemotron = await _nemotron(text || '', imageRef, remaining(), contentType);
  if (!nemotron.skipped) {
    const parsed = nemotron.parsed;
    return {
      flagged: Boolean(parsed.flagged),
      categories: _normalizeCategories(parsed.categories),
      action: _deriveAction(parsed),
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      provider: 'nemotron',
      available: true,
    };
  }

  const omni = await _omni(text || '', imageRef, remaining());
  if (!omni.skipped) {
    const parsed = omni.parsed;
    return {
      flagged: Boolean(parsed.flagged),
      categories: _normalizeCategories(parsed.categories),
      action: _deriveAction(parsed),
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      provider: 'omni',
      available: true,
    };
  }

  const zhipu = await _zhipu(text || '', imageRef, remaining());
  if (!zhipu.skipped) {
    const parsed = zhipu.parsed;
    return {
      flagged: Boolean(parsed.flagged),
      categories: _normalizeCategories(parsed.categories),
      action: _deriveAction(parsed),
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      provider: 'zhipu',
      available: true,
    };
  }

  // Все ИИ недоступны — публикуем с пометкой pending_ai_review.
  return {
    flagged: false,
    categories: [],
    action: 'pass',
    reasoning: 'ИИ-модерация недоступна (все провайдеры недоступны/таймаут).',
    provider: null,
    available: false,
  };
}

/** Доступна ли ИИ-модерация прямо сейчас (для диагностики/тестов). */
export function aiActiveNow() {
  return Boolean(openRouterKey() || openAiKey()) && !circuit.degraded;
}