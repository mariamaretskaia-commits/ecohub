import crypto from 'crypto';

/**
 * Validate Telegram WebApp initData (HMAC).
 * Tries with and without excluding `signature` (added for third-party checks).
 * @returns {{ user: object } | { error: string }}
 */
export function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return { error: 'empty' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { error: 'missing_hash' };

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (!authDate) return { error: 'missing_auth_date' };
  if (Date.now() / 1000 - authDate > 86400) return { error: 'expired' };

  const pairs = [...params.entries()].filter(([key]) => key !== 'hash');
  const variants = [
    pairs,
    pairs.filter(([key]) => key !== 'signature'),
  ];

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  let hashOk = false;
  for (const list of variants) {
    const dataCheckString = list
      .slice()
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash === hash) {
      hashOk = true;
      break;
    }
  }

  if (!hashOk) return { error: 'bad_hash' };

  const userStr = params.get('user');
  if (!userStr) return { error: 'missing_user' };

  try {
    return { user: JSON.parse(userStr) };
  } catch {
    return { error: 'bad_user_json' };
  }
}

function safeDecode(value) {
  if (!value) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isLocalHost(req) {
  const host = String(req.headers.host || '').split(':')[0];
  return host === 'localhost' || host === '127.0.0.1';
}

/** Collect initData from custom header or Authorization: tma <data> */
function extractInitData(req) {
  const header = req.headers['x-telegram-init-data'];
  if (header) return Array.isArray(header) ? header[0] : header;

  const auth = req.headers.authorization || '';
  const m = String(auth).match(/^tma\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function resolveUser(raw, botToken) {
  const candidates = [raw, safeDecode(raw)].filter(Boolean);
  let lastError = 'invalid';
  for (const candidate of candidates) {
    const result = validateTelegramInitData(candidate, botToken);
    if (result.user) return { user: result.user };
    lastError = result.error || lastError;
    const again = validateTelegramInitData(safeDecode(candidate), botToken);
    if (again.user) return { user: again.user };
    lastError = again.error || lastError;
  }
  return { error: lastError };
}

export function authMiddleware(req, res, next) {
  const raw = extractInitData(req);
  const botToken = String(process.env.BOT_TOKEN || '').trim();

  if (req.headers['x-dev-user'] && isLocalHost(req)) {
    try {
      req.telegramUser = JSON.parse(safeDecode(req.headers['x-dev-user']));
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid dev user' });
    }
  }

  if (!botToken) {
    console.warn('Auth failed: BOT_TOKEN missing');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!raw) {
    console.warn('Auth failed: no initData header');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const resolved = resolveUser(raw, botToken);
  if (!resolved.user) {
    const keys = (() => {
      try {
        return [...new URLSearchParams(raw).keys()].join(',');
      } catch {
        return '?';
      }
    })();
    console.warn(`Auth failed: ${resolved.error} keys=${keys} len=${String(raw).length}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.telegramUser = resolved.user;
  next();
}

/** Auth if headers present; otherwise continue anonymously. */
export function optionalAuthMiddleware(req, _res, next) {
  const raw = extractInitData(req);
  const botToken = String(process.env.BOT_TOKEN || '').trim();

  if (req.headers['x-dev-user'] && isLocalHost(req)) {
    try {
      req.telegramUser = JSON.parse(safeDecode(req.headers['x-dev-user']));
    } catch {
      /* ignore */
    }
    return next();
  }

  if (raw && botToken) {
    const resolved = resolveUser(raw, botToken);
    if (resolved.user) req.telegramUser = resolved.user;
  }
  next();
}
