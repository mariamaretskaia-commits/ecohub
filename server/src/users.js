import { get, run } from './db.js';
import { assertCleanNickname } from './moderation.js';

const NICK_RE = /^[А-Яа-яЁёІіЎў''\- ]{2,50}$/;

export function normalizeNickname(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

export function isValidNickname(raw) {
  const name = normalizeNickname(raw);
  if (!NICK_RE.test(name) || !/[А-Яа-яЁёІіЎў]/.test(name)) return false;
  try {
    assertCleanNickname(name);
  } catch {
    return false;
  }
  return true;
}

export function normalizePhone(raw) {
  let digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (digits.startsWith('80') && digits.length >= 11) digits = `+375${digits.slice(2)}`;
  else if (digits.startsWith('8') && digits.length >= 11) digits = `+375${digits.slice(1)}`;
  else if (digits.startsWith('375')) digits = `+${digits}`;
  else if (!digits.startsWith('+') && digits.length === 9) digits = `+375${digits}`;
  else if (!digits.startsWith('+')) digits = `+${digits}`;
  return digits;
}

export function isProfileComplete(user) {
  return Boolean(user && isValidNickname(user.nickname));
}

export function displayName(user) {
  const nick = normalizeNickname(user?.nickname);
  if (nick) return nick;
  const parts = [user?.last_name, user?.first_name, user?.patronymic].map((p) => String(p || '').trim()).filter(Boolean);
  return parts.join(' ') || user?.first_name || 'Участник';
}

export function publicUser(user) {
  if (!user) return null;
  return {
    ...user,
    profile_complete: isProfileComplete(user),
    display_name: displayName(user),
  };
}

export async function getUserById(id) {
  return get('SELECT * FROM users WHERE id = ?', id);
}

export async function findOrCreateUser(telegramUser) {
  const telegramId = String(telegramUser?.id || '').trim();
  if (!telegramId || telegramId === 'undefined') {
    throw Object.assign(new Error('Нужен аккаунт Telegram'), { status: 401 });
  }

  let user = await get('SELECT * FROM users WHERE telegram_id = ?', telegramId);

  if (!user) {
    try {
      const result = await run(`
        INSERT INTO users (telegram_id, username, first_name, last_name, photo_url, eco_coins)
        VALUES (?, ?, ?, ?, ?, 0)
      `,
      telegramId,
      telegramUser.username || null,
      telegramUser.first_name || '',
      telegramUser.last_name || null,
      telegramUser.photo_url || null);
      user = await getUserById(result.lastInsertRowid);
    } catch {
      user = await get('SELECT * FROM users WHERE telegram_id = ?', telegramId);
    }
  }

  if (!user) {
    throw Object.assign(new Error('Не удалось открыть профиль'), { status: 500 });
  }

  await run(`
    UPDATE users SET username = ?, photo_url = ?
    WHERE telegram_id = ?
  `,
  telegramUser.username || user.username,
  telegramUser.photo_url || user.photo_url,
  telegramId);

  return get('SELECT * FROM users WHERE telegram_id = ?', telegramId);
}

export function validateNickname(raw) {
  const nickname = normalizeNickname(raw);
  if (!NICK_RE.test(nickname) || !/[А-Яа-яЁёІіЎў]/.test(nickname)) {
    throw Object.assign(
      new Error('Имя только кириллицей, до 50 символов. Например: Марья Марецкая'),
      { status: 400 },
    );
  }
  assertCleanNickname(nickname);
  return nickname;
}

export async function saveProfile(userId, fields, consent) {
  const nickname = validateNickname(fields.nickname ?? fields.first_name);
  const prev = await getUserById(userId);
  if (!prev?.consent_at && !consent) {
    throw Object.assign(new Error('Нужно согласие, что это имя увидят другие пользователи'), { status: 400 });
  }
  await run(`
    UPDATE users
    SET nickname = ?,
        consent_at = COALESCE(consent_at, datetime('now'))
    WHERE id = ?
  `, nickname, userId);
  return publicUser(await getUserById(userId));
}

export async function attachOwnPhone(telegramUser, contact) {
  if (!contact?.phone_number) {
    throw Object.assign(new Error('Нет номера'), { status: 400 });
  }
  if (!contact.user_id || String(contact.user_id) !== String(telegramUser.id)) {
    throw Object.assign(new Error('Нужен ваш номер – кнопка «Поделиться номером», не чужой контакт.'), { status: 400 });
  }

  const phone = normalizePhone(contact.phone_number);
  if (!/^\+\d{10,15}$/.test(phone)) {
    throw Object.assign(new Error('Не похоже на телефон. Попробуйте ещё раз.'), { status: 400 });
  }

  const current = await findOrCreateUser(telegramUser);
  const owner = await get('SELECT * FROM users WHERE phone = ? AND id != ?', phone, current.id);
  if (owner) {
    throw Object.assign(
      new Error('Профиль EcoHub привязан к Telegram: один аккаунт – один профиль. Этот номер уже у другого профиля.'),
      { status: 409 },
    );
  }

  await run('UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?', phone, current.id);
  return { ...publicUser(await getUserById(current.id)), relinked: false };
}

export async function attachDevPhone(userId, rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!/^\+\d{10,15}$/.test(phone)) {
    throw Object.assign(new Error('Введите телефон в международном формате, например +375291112233'), { status: 400 });
  }
  const owner = await get('SELECT * FROM users WHERE phone = ? AND id != ?', phone, userId);
  if (owner) {
    throw Object.assign(new Error('Этот номер уже привязан к другому профилю'), { status: 400 });
  }
  await run('UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?', phone, userId);
  return publicUser(await getUserById(userId));
}
