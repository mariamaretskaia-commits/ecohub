import crypto from 'crypto';

/**
 * Одноразовые токены для скачивания копии персональных данных (ст. 11 Закона № 99-З).
 * Токен живёт короткое время, привязан к пользователю и может быть использован только один раз.
 */

const TOKEN_TTL_MS = 2 * 60 * 1000;
const MAX_TOKENS = 5000;

const tokens = new Map();

function cleanupLocked() {
  const now = Date.now();
  for (const [token, entry] of tokens) {
    if (entry.exp <= now) tokens.delete(token);
  }
}

/** Создать одноразовый токен скачивания для telegram_id. */
export function createDownloadToken(telegramId) {
  cleanupLocked();
  if (tokens.size >= MAX_TOKENS) {
    const now = Date.now();
    for (const [token, entry] of tokens) {
      if (tokens.size < MAX_TOKENS) break;
      tokens.delete(token);
      if (entry.exp < now) continue;
    }
  }
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, { telegramId: String(telegramId), used: false, exp: Date.now() + TOKEN_TTL_MS });
  return token;
}

/** Извлечь telegram_id по токену либо вернуть причину отказа. */
export function consumeDownloadToken(rawToken) {
  if (!rawToken) return { error: 'missing' };
  const entry = tokens.get(String(rawToken));
  if (!entry) return { error: 'invalid' };
  if (Date.now() > entry.exp) {
    tokens.delete(String(rawToken));
    return { error: 'expired' };
  }
  if (entry.used) return { error: 'used' };
  entry.used = true;
  tokens.delete(String(rawToken));
  return { telegramId: entry.telegramId };
}

/** Очистка (для тестов). */
export function _resetDownloadTokens() {
  tokens.clear();
}