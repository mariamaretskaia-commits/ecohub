const API_BASE = import.meta.env.VITE_API_URL || '';

function isTelegramWebApp() {
  return Boolean(window.Telegram?.WebApp?.initData);
}

function apiUrls(path) {
  if (API_BASE) return [`${API_BASE}${path}`];
  if (!path.startsWith('/api')) return [path];

  if (isTelegramWebApp()) return [path];

  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  return isLocal ? [path, `http://127.0.0.1:3001${path}`] : [path];
}

function encodeHeader(value) {
  return encodeURIComponent(value);
}

function devUserHeader() {
  return encodeHeader(JSON.stringify({
    id: 123456789,
    first_name: 'Test',
    username: 'test_user',
  }));
}

function getHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const tg = window.Telegram?.WebApp;

  if (tg?.initData) {
    // initData is already a query-string; do not encodeURIComponent the whole value
    headers['X-Telegram-Init-Data'] = tg.initData;
    headers.Authorization = `tma ${tg.initData}`;
  } else {
    headers['X-Dev-User'] = devUserHeader();
  }

  return headers;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wake free-tier host (Render sleep) before real API calls. */
async function wakeServer() {
  const bases = [];
  if (API_BASE) bases.push(API_BASE.replace(/\/$/, ''));
  else bases.push('');
  const healthUrls = bases.map((b) => `${b}/health`);
  const gaps = [0, 2000, 4000, 6000, 8000, 10000, 12000];
  for (let i = 0; i < gaps.length; i += 1) {
    if (gaps[i]) await sleep(gaps[i]);
    for (const url of healthUrls) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) return true;
      } catch {
        /* keep trying */
      }
    }
  }
  return false;
}

/** Retries help when a free host is waking from sleep (cold start). */
async function request(path, options = {}) {
  if (path.startsWith('/api') && !options.skipWake) {
    await wakeServer();
  }

  const urls = apiUrls(path);
  const attempts = isTelegramWebApp() ? 8 : 3;
  const gaps = [0, 2000, 3000, 4000, 5000, 7000, 9000, 12000];

  let lastError = new Error('Request failed');
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (gaps[attempt]) await sleep(gaps[attempt]);
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          ...options,
          cache: 'no-store',
          headers: {
            ...getHeaders(),
            ...options.headers,
          },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Request failed' }));
          lastError = new Error(err.error || 'Request failed');
          if (res.status >= 500 || res.status === 502 || res.status === 503 || res.status === 504) {
            continue;
          }
          throw lastError;
        }
        return res.json();
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw lastError;
}

function authUploadHeaders() {
  if (window.Telegram?.WebApp?.initData) {
    const initData = window.Telegram.WebApp.initData;
    return {
      'X-Telegram-Init-Data': initData,
      Authorization: `tma ${initData}`,
    };
  }
  return { 'X-Dev-User': devUserHeader() };
}

async function uploadItem(path, method, formData) {
  const urls = apiUrls(path);

  let lastError = new Error('Request failed');
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method,
        headers: authUploadHeaders(),
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        lastError = new Error(err.error || 'Request failed');
        continue;
      }
      return res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export const api = {
  getMe: () => request('/api/me'),
  saveProfile: (body) => request('/api/me', { method: 'PATCH', body: JSON.stringify(body) }),
  verifyDevPhone: (phone) =>
    request('/api/me/phone-dev', { method: 'POST', body: JSON.stringify({ phone }) }),
  getItems: (params = {}) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v))
    ).toString();
    return request(`/api/items${q ? `?${q}` : ''}`);
  },
  createItem: (formData) => uploadItem('/api/items', 'POST', formData),
  updateItem: (id, formData) => uploadItem(`/api/items/${id}`, 'PATCH', formData),
  deleteItem: (id) => request(`/api/items/${id}`, { method: 'DELETE' }),
  markGiven: (id) =>
    request(`/api/items/${id}/give`, { method: 'PATCH' }),
  wantItem: (id) =>
    request(`/api/items/${id}/want`, { method: 'POST' }),
  toggleFavorite: (id) =>
    request(`/api/items/${id}/favorite`, { method: 'POST' }),
  getFavorites: () => request('/api/items?favorites=1'),
  getPoints: (params = {}) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v))
    ).toString();
    return request(`/api/points${q ? `?${q}` : ''}`);
  },
  getPoint: (id) => request(`/api/points/${id}`),
  getLeaderboard: () => request('/api/leaderboard'),
};

export const CATEGORIES = [
  'Одежда',
  'Обувь',
  'Детям',
  'Мебель',
  'Техника',
  'Электроника',
  'Посуда',
  'Книги',
  'Спорт',
  'Инструменты',
  'Красота',
  'Растения',
  'Животным',
  'Другое',
];

export const POINT_TYPES = {
  paper: { label: 'Макулатура', sticker: 'paper', color: '#2fb66a' },
  electronics: { label: 'Бытовая техника', sticker: 'electronics', color: '#5b8def' },
  clothing: { label: 'Одежда и игрушки', sticker: 'clothing', color: '#f5c542' },
  hazardous: { label: 'Опасные отходы', sticker: 'hazardous', color: '#ef6b6b' },
  metal: { label: 'Металлолом', sticker: 'metal', color: '#8a93a3' },
};
