import crypto from 'crypto';

export function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculatedHash !== hash) return null;

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (Date.now() / 1000 - authDate > 86400) return null;

  const userStr = params.get('user');
  if (!userStr) return null;

  try {
    return JSON.parse(userStr);
  } catch {
    return null;
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

export function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  const botToken = process.env.BOT_TOKEN;

  if (req.headers['x-dev-user'] && isLocalHost(req)) {
    try {
      req.telegramUser = JSON.parse(safeDecode(req.headers['x-dev-user']));
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid dev user' });
    }
  }

  const user = validateTelegramInitData(safeDecode(initData), botToken);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.telegramUser = user;
  next();
}

/** Auth if headers present; otherwise continue anonymously. */
export function optionalAuthMiddleware(req, _res, next) {
  const initData = req.headers['x-telegram-init-data'];
  const botToken = process.env.BOT_TOKEN;

  if (req.headers['x-dev-user'] && isLocalHost(req)) {
    try {
      req.telegramUser = JSON.parse(safeDecode(req.headers['x-dev-user']));
    } catch {
      /* ignore */
    }
    return next();
  }

  const user = validateTelegramInitData(safeDecode(initData), botToken);
  if (user) req.telegramUser = user;
  next();
}
