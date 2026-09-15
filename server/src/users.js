import { get, run, all } from './db.js';
import { deleteStoredPhotos } from './storage.js';
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
    // До согласия сохраняем минимум — только идентификатор, нужный для фиксации согласия.
    try {
      const result = await run('INSERT INTO users (telegram_id) VALUES (?)', telegramId);
      user = await getUserById(result.lastInsertRowid);
    } catch {
      user = await get('SELECT * FROM users WHERE telegram_id = ?', telegramId);
    }
  }

  if (!user) {
    throw Object.assign(new Error('Не удалось открыть профиль'), { status: 500 });
  }

  // Имя/username/фото подтягиваем только после согласия (отзывчивость к минимальности сбора).
  if (user.terms_privacy_at || user.consent_at) {
    await run(`
      UPDATE users SET username = ?, photo_url = ?
      WHERE telegram_id = ?
    `,
    telegramUser.username || user.username,
    telegramUser.photo_url || user.photo_url,
    telegramId);
  }

  return get('SELECT * FROM users WHERE telegram_id = ?', telegramId);
}

export function validateNickname(raw) {
  const nickname = normalizeNickname(raw);
  if (!NICK_RE.test(nickname) || !/[А-Яа-яЁёІіЎў]/.test(nickname)) {
    throw Object.assign(
      new Error('Имя только кириллицей, до 50 символов. Например: Иванов Иван'),
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
  if (!prev?.terms_rules_at && !fields.terms_rules) {
    throw Object.assign(new Error('Чтобы сохранить профиль, ознакомьтесь с Правилами сообщества и согласитесь с ними'), { status: 400 });
  }
  if (!prev?.terms_privacy_at && !fields.terms_privacy) {
    throw Object.assign(new Error('Чтобы сохранить профиль, ознакомьтесь с политикой обработки данных и согласитесь с ней'), { status: 400 });
  }
  await run(`
    UPDATE users
    SET nickname = ?,
        consent_at = COALESCE(consent_at, datetime('now')),
        terms_rules_at = COALESCE(terms_rules_at, datetime('now')),
        terms_privacy_at = COALESCE(terms_privacy_at, datetime('now'))
    WHERE id = ?
  `, nickname, userId);
  return publicUser(await getUserById(userId));
}

export async function acceptLegal(userId, fields, telegramUser) {
  if (!fields?.terms_rules) {
    throw Object.assign(new Error('Чтобы пользоваться EcoHub, ознакомьтесь с Правилами сообщества и согласитесь с ними'), { status: 400 });
  }
  if (!fields?.terms_privacy) {
    throw Object.assign(new Error('Чтобы пользоваться EcoHub, ознакомьтесь с политикой обработки данных и согласитесь с ней'), { status: 400 });
  }
  await run(`
    UPDATE users
    SET terms_rules_at = COALESCE(terms_rules_at, datetime('now')),
        terms_privacy_at = COALESCE(terms_privacy_at, datetime('now'))
    WHERE id = ?
  `, userId);
  if (telegramUser?.username || telegramUser?.first_name || telegramUser?.last_name || telegramUser?.photo_url) {
    await run(`
      UPDATE users
      SET username = COALESCE(?, username),
          first_name = COALESCE(?, first_name),
          last_name = COALESCE(?, last_name),
          photo_url = COALESCE(?, photo_url)
      WHERE id = ?
    `,
    telegramUser.username || null,
    telegramUser.first_name || null,
    telegramUser.last_name || null,
    telegramUser.photo_url || null,
    userId);
  }
  return publicUser(await getUserById(userId));
}

/** Включить/выключить напоминания и авто-удаление невостребованных объявлений. */
export async function setNudgesDisabled(userId, disabled) {
  await run('UPDATE users SET nudges_disabled = ? WHERE id = ?', disabled ? 1 : 0, userId);
  return publicUser(await getUserById(userId));
}

function parsePhotosFromRow(row) {
  try {
    const raw = row?.photos;
    if (raw) {
      const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(list)) return list.filter(Boolean);
    }
  } catch { /* ignore */ }
  return row?.photo_url ? [row.photo_url] : [];
}

/** Копия персональных данных субъекта в удобочитаемой форме (ст. 11 Закона № 99-З). */
export async function exportUserData(userId) {
  const profile = await getUserById(userId);
  const [items, wants, favorites, transactions, submissions, suggestions, messages] = await Promise.all([
    all('SELECT * FROM items WHERE user_id = ? ORDER BY id', userId),
    all(
      `SELECT item_wants.*, items.title AS item_title
       FROM item_wants LEFT JOIN items ON items.id = item_wants.item_id
       WHERE item_wants.buyer_id = ? ORDER BY item_wants.id`,
      userId,
    ),
    all('SELECT * FROM item_favorites WHERE user_id = ? ORDER BY id', userId),
    all('SELECT * FROM eco_transactions WHERE user_id = ? ORDER BY id', userId),
    all('SELECT * FROM recycling_submissions WHERE user_id = ? ORDER BY id', userId),
    all('SELECT * FROM point_suggestions WHERE user_id = ? ORDER BY id', userId),
    all('SELECT * FROM chat_messages WHERE sender_id = ? ORDER BY id', userId),
  ]);
  return {
    exported_at: new Date().toISOString(),
    profile: profile ? publicUser(profile) : null,
    items,
    wants,
    favorites,
    transactions,
    submissions,
    suggestions,
    messages,
  };
}

/** Полное удаление данных пользователя (ст. 11, 14 Закона № 99-З). */
export async function deleteUserData(userId) {
  const user = await getUserById(userId);
  if (!user) return { ok: true, photosRemoved: 0 };
  const chatId = String(user.telegram_id || '');

  const photos = [];
  for (const it of await all('SELECT photo_url, photos FROM items WHERE user_id = ?', userId)) {
    photos.push(...parsePhotosFromRow(it));
  }
  for (const m of await all('SELECT photo_url FROM chat_messages WHERE sender_id = ?', userId)) {
    if (m.photo_url) photos.push(m.photo_url);
  }
  for (const s of await all('SELECT photo_url FROM recycling_submissions WHERE user_id = ?', userId)) {
    if (s.photo_url) photos.push(s.photo_url);
  }

  await run('DELETE FROM chat_messages WHERE sender_id = ?', userId);
  await run('DELETE FROM item_wants WHERE buyer_id = ?', userId);
  await run('DELETE FROM items WHERE user_id = ?', userId);
  await run('DELETE FROM item_favorites WHERE user_id = ?', userId);
  await run('DELETE FROM eco_transactions WHERE user_id = ?', userId);
  await run('DELETE FROM recycling_submissions WHERE user_id = ?', userId);
  await run('DELETE FROM point_suggestions WHERE user_id = ?', userId);
  await run('DELETE FROM users WHERE id = ?', userId);

  // Мета-записи поддержки: режим + карты ответов, где пользователь — автор запроса.
  if (chatId) {
    await run('DELETE FROM meta WHERE key = ?', `support_mode_${chatId}`);
    const devMsgs = await all("SELECT key, value FROM meta WHERE key LIKE 'support_devmsg_%'");
    for (const row of devMsgs) {
      try {
        const val = JSON.parse(row.value);
        if (val && String(val.user) === chatId) await run('DELETE FROM meta WHERE key = ?', row.key);
      } catch { /* ignore */ }
    }
  }

  // Модерационные журналы обезличиваются: события сохраняются, персональные данные — нет.
  await run(
    'UPDATE mod_messages SET sender_telegram_id = NULL, receiver_telegram_id = NULL WHERE sender_telegram_id = ? OR receiver_telegram_id = ?',
    chatId,
    chatId,
  );
  await run(
    'UPDATE mod_reports SET sender_telegram_id = NULL, reporter_telegram_id = NULL WHERE sender_telegram_id = ? OR reporter_telegram_id = ?',
    chatId,
    chatId,
  );
  await run(
    'UPDATE mod_log SET target_telegram_id = NULL, actor = NULL WHERE target_telegram_id = ? OR actor = ?',
    chatId,
    chatId,
  );
  await run('DELETE FROM mod_trust WHERE telegram_id = ?', chatId);
  await run('DELETE FROM mod_banned WHERE telegram_id = ?', chatId);

  await deleteStoredPhotos(photos);
  return { ok: true, photosRemoved: photos.length };
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
