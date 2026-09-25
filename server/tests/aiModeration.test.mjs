import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { moderateContent, photoToAiRef, aiActiveNow, __setFetch, __resetForTests, openRouterModel } from '../src/aiModeration.js';

const ENV_KEYS = [
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_MODERATION_URL',
  'AI_MODERATION_BUDGET_MS',
  'AI_MODERATION_TIMEOUT_MS',
  'OPENROUTER_DISABLE_REASONING',
];

const savedEnv = {};
function captureEnv() {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

function fakeOk(data, status = 200) {
  return Promise.resolve({ status, json: () => Promise.resolve(data) });
}
function fakeStatus(status) {
  return Promise.resolve({ status, json: () => Promise.resolve({}) });
}
function fakeHttp(status) {
  return Promise.resolve({ status, json: () => Promise.resolve({}) });
}
function hangsForever() {
  return new Promise(() => {});
}

let calls = [];
function recordFetch(handler) {
  calls = [];
  const fn = (url, opts) => {
    calls.push({ url, opts });
    return handler(url, opts);
  };
  __setFetch(fn);
  return fn;
}

beforeEach(() => {
  captureEnv();
  __resetForTests();
});
afterEach(() => {
  __resetForTests();
  restoreEnv();
});

test('nemotron блокирует обфусцированные наркотики (категория drugs)', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-test';
  recordFetch((url) => {
    if (String(url).includes('openrouter.ai')) {
      return fakeOk({
        choices: [{ message: { content: 'User Safety: unsafe\nSafety Categories: drugs' } }],
      });
    }
    return fakeStatus(401);
  });
  const res = await moderateContent({ text: 'Продам %N@RкОТ%к оптом', contentType: 'listing' });
  assert.equal(res.provider, 'nemotron');
  assert.equal(res.action, 'block');
  assert.equal(res.flagged, true);
  assert.deepEqual(res.categories, ['drugs']);
});

test('nemotron (классификатор) пропускает безопасный контент', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-test';
  recordFetch(() => fakeOk({
    choices: [{ message: { content: 'User Safety: safe' } }],
  }));
  const res = await moderateContent({ text: 'Отдам детский велосипед, в хорошем состоянии', contentType: 'listing' });
  assert.equal(res.provider, 'nemotron');
  assert.equal(res.action, 'pass');
  assert.equal(res.flagged, false);
});

test('nemotron unsafe без хард-категории → action review (консервативно)', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-test';
  recordFetch(() => fakeOk({
    choices: [{ message: { content: 'User Safety: unsafe\nSafety Categories: Profanity' } }],
  }));
  const res = await moderateContent({ text: 'продам %N@RкОТ%к оптом', contentType: 'message' });
  assert.equal(res.flagged, true);
  assert.equal(res.action, 'review');
  assert.deepEqual(res.categories, ['profanity']);
});

test('nemotron 401 → fallback на omni-moderation (review)', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-test';
  process.env.OPENAI_MODERATION_URL = 'https://api.openai.echo/v1/moderations';
  process.env.OPENAI_API_KEY = 'sk-openai';
  recordFetch((url) => {
    if (String(url).includes('openrouter.ai')) return fakeStatus(401);
    if (String(url).includes('moderations')) {
      return fakeOk({ results: [{ flagged: true, categories: { sexual: true }, category_scores: {} }] });
    }
    return fakeStatus(500);
  });
  const res = await moderateContent({ text: 'S€x€ товар', contentType: 'listing' });
  assert.equal(res.provider, 'omni');
  assert.equal(res.action, 'review');
  assert.deepEqual(res.categories, ['sexual']);
});

test('nemotron нераспознанный ответ → fallback на omni (pass)', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-test';
  process.env.OPENAI_API_KEY = 'sk-openai';
  recordFetch((url) => {
    if (String(url).includes('openrouter.ai')) {
      return fakeOk({ choices: [{ message: { content: 'бла бла бла ничего похожего на вердикт' } }] });
    }
    return fakeOk({ results: [{ flagged: false, categories: {}, category_scores: {} }] });
  });
  const res = await moderateContent({ text: 'обычный текст', contentType: 'listing' });
  assert.equal(res.provider, 'omni');
  assert.equal(res.action, 'pass');
  assert.equal(res.flagged, false);
});

test('все провайдеры недоступны → available:false, action pass (печатаем с меткой)', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-test';
  delete process.env.OPENAI_API_KEY;
  recordFetch(() => fakeHttp(500));
  const res = await moderateContent({ text: 'тест', contentType: 'listing' });
  assert.equal(res.available, false);
  assert.equal(res.action, 'pass');
  assert.equal(res.flagged, false);
});

test('таймаут nemotron укладывается в бюджет и не блокирует', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-test';
  process.env.AI_MODERATION_BUDGET_MS = '300';
  process.env.AI_MODERATION_TIMEOUT_MS = '2000';
  __setFetch(() => hangsForever());
  const t0 = Date.now();
  const res = await moderateContent({ text: 'медленный провайдер', contentType: 'message' });
  const elapsed = Date.now() - t0;
  assert.equal(res.available, false);
  assert.ok(elapsed < 1500, `бюджет нарушен: ${elapsed}ms`);
});

test('картинка передаётся в запрос Nemotron как data-URI', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-test';
  let body = null;
  __setFetch((url, opts) => {
    if (String(url).includes('openrouter.ai')) {
      body = JSON.parse(opts.body);
      return fakeOk({ choices: [{ message: { content: 'User Safety: safe' } }] });
    }
    return fakeStatus(401);
  });
  const b64 = 'iVBORw0KGgoAAAANSUhEUg==';
  await moderateContent({ text: 'вещь', imageBase64: b64, contentType: 'listing' });
  const userContent = body.messages[1].content;
  const img = userContent.find((p) => p.type === 'image_url');
  assert.ok(img, 'изображение не передано');
  assert.equal(img.image_url.url, `data:image/jpeg;base64,${b64}`);
  assert.equal(body.reasoning?.enabled, false, 'reasoning должен быть отключён для скорости');
});

test('omni требует input_type для изображения', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-test';
  process.env.OPENAI_API_KEY = 'sk-openai';
  let omniBody = null;
  __setFetch((url, opts) => {
    if (String(url).includes('openrouter.ai')) return fakeStatus(429, 'retry-below');
    if (String(url).includes('moderations')) {
      omniBody = JSON.parse(opts.body);
      return fakeOk({ results: [{ flagged: false, categories: {}, category_scores: {} }] });
    }
    return fakeStatus(500);
  });
  await moderateContent({ text: 'текст', imageBase64: 'AAAA', contentType: 'listing' });
  assert.equal(omniBody.model, 'omni-moderation-latest');
  assert.equal(omniBody.input_type, 'image');
  assert.equal(omniBody.input[0].type, 'image_url');
});

test('photoToAiRef: data:/http пропускаются, /uploads превращается в data-URI', () => {
  assert.equal(photoToAiRef('data:image/png;base64,abc'), 'data:image/png;base64,abc');
  assert.equal(photoToAiRef('https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg');
  assert.equal(photoToAiRef(null), null);
  assert.equal(photoToAiRef('/uploads/nonexistent-x.jpg'), null);
});

test('aiActiveNow учитывает ключи', () => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  assert.equal(aiActiveNow(), false);
  process.env.OPENROUTER_API_KEY = 'sk-test';
  assert.equal(aiActiveNow(), true);
});

test('openRouterModel по умолчанию content-safety free, переопределяется env', () => {
  delete process.env.OPENROUTER_MODEL;
  assert.equal(openRouterModel(), 'nvidia/nemotron-3.5-content-safety:free');
  process.env.OPENROUTER_MODEL = 'nvidia/nemotron-3.5-content-safety';
  assert.equal(openRouterModel(), 'nvidia/nemotron-3.5-content-safety');
});