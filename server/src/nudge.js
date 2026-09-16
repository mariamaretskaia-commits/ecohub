import { all, run } from './db.js';
import { removeItemWithAssets } from './items.js';

/**
 * Жизненный цикл невостребованного объявления.
 * Правила (зафиксированы с владельцем проекта):
 *  - 14 дней без единого отклика «Хочу взять» — одно напоминание автору;
 *  - 21 день без откликов — автоматическое удаление объявления;
 *  - любой отклик отменяет и напоминание, и удаление;
 *  - отписка в профиле отключает и напоминания, и авто-удаление.
 */

export const UNCLAIMED_DELETE_DAYS = 21;
export const REMINDER_BEFORE_DAYS = 7;
export const NUDGE_BATCH = 20;

/** Категория объявления → фильтр карты пунктов приёма. */
const CATEGORY_TO_POINT_TYPE = {
  'Всё для детей и мам': 'clothing',
  'Женский гардероб': 'clothing',
  'Мужской гардероб': 'clothing',
  'Одежда': 'clothing',
  'Телефоны и планшеты': 'electronics',
  'Электроника': 'electronics',
  'Компьютерная техника': 'electronics',
  'Бытовая техника': 'electronics',
};

export function mapCategoryToPointType(category) {
  return CATEGORY_TO_POINT_TYPE[category] || null;
}

/**
 * Общие условия «невостребованности»:
 * активное объявление, автор с согласиями и без отписки, не демо,
 * и ни одной заявки «Хочу взять» за всё время.
 */
const UNCLAIMED_WHERES = `
  i.status = 'active'
  AND i.user_id IS NOT NULL
  AND u.telegram_id NOT LIKE 'demo_%'
  AND COALESCE(u.nudges_disabled, 0) = 0
  AND u.terms_rules_at IS NOT NULL
  AND u.terms_privacy_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM item_wants w WHERE w.item_id = i.id)
`;

function parseDbDate(value) {
  if (!value) return null;
  const d = new Date(
    value instanceof Date
      ? value.getTime()
      : String(value).replace(' ', 'T') + (String(value).includes('T') ? '' : 'Z'),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(d) {
  if (!d) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

/** Кандидаты на напоминание: дедлайн наступил не позднее, чем через 7 дней. */
export async function selectItemsForUnclaimedNudge(limit = NUDGE_BATCH) {
  return all(`
    SELECT i.*, u.telegram_id AS owner_tg,
           u.nickname AS owner_nickname, u.first_name AS owner_name, u.last_name AS owner_last
    FROM items i JOIN users u ON u.id = i.user_id
    WHERE ${UNCLAIMED_WHERES}
      AND i.unclaimed_nudge_at IS NULL
      AND i.unclaimed_delete_at IS NOT NULL
      AND i.unclaimed_delete_at <= datetime('now', '+7 days')
    ORDER BY i.created_at
    LIMIT ?
  `, limit);
}

/** Кандидаты на авто-удаление: дедлайн уже прошёл. */
export async function selectItemsForUnclaimedRemoval(limit = NUDGE_BATCH) {
  return all(`
    SELECT i.*, u.telegram_id AS owner_tg
    FROM items i JOIN users u ON u.id = i.user_id
    WHERE ${UNCLAIMED_WHERES}
      AND i.unclaimed_delete_at IS NOT NULL
      AND i.unclaimed_delete_at <= datetime('now')
    ORDER BY i.unclaimed_delete_at
    LIMIT ?
  `, limit);
}

export function buildUnclaimedText(item) {
  const deadline = parseDbDate(item.unclaimed_delete_at);
  const created = parseDbDate(item.created_at);
  const daysListed = created
    ? Math.max(0, Math.round((Date.now() - created.getTime()) / 86400000))
    : REMINDER_BEFORE_DAYS;
  const deadlineText = deadline ? formatDate(deadline) : `${UNCLAIMED_DELETE_DAYS} дней с момента публикации`;

  return [
    `👋 Здравствуйте! Ваше объявление «${item.title}» (${item.category}) размещено уже ${daysListed > 0 ? `${daysListed} дн. назад` : 'недавно'} — на него пока никто не откликнулся.`,
    '',
    `Если на объявление не откликнутся до ${deadlineText}, оно будет удалено автоматически.`,
    '',
    'Что можно сделать:',
    '• 🗺 Сдать вещь на переработку или в благотворительность;',
    '• ✏️ Снять объявление досрочно — профиль → «Мои объявления».',
    '',
    'Напоминания и авто-удаление можно отключить в настройках профиля.',
  ].join('\n');
}

export function buildKeyboard(item, webAppUrl) {
  const row1 = [];
  if (webAppUrl) {
    const pointType = mapCategoryToPointType(item.category);
    if (pointType) {
      row1.push({ text: '🗺 Куда сдать', web_app: { url: `${webAppUrl}?map=${pointType}` } });
    }
    return {
      inline_keyboard: [
        row1,
        [{ text: '✏️ Мои объявления', web_app: { url: `${webAppUrl}?tab=profile` } }],
      ].filter((row) => row.length),
    };
  }
  return undefined;
}

/** Отправить напоминания и пометить отправленное (даже при ошибке доставки). */
export async function sendUnclaimedNudges(bot, webAppUrl = '') {
  const items = await selectItemsForUnclaimedNudge();
  let sent = 0;
  for (const item of items) {
    try {
      if (bot && item.owner_tg) {
        await bot.telegram.sendMessage(
          item.owner_tg,
          buildUnclaimedText(item),
          { disable_notification: false, reply_markup: buildKeyboard(item, webAppUrl) },
        );
      }
      sent += 1;
    } catch (err) {
      console.warn(`[nudge] не удалось отправить напоминание по объявлению ${item.id}: ${err.message}`);
    } finally {
      await run('UPDATE items SET unclaimed_nudge_at = datetime(\'now\') WHERE id = ?', item.id);
    }
  }
  return sent;
}

/** Автоматически удалить объявления с истёкшим дедлайном. */
export async function removeUnclaimedItems() {
  const items = await selectItemsForUnclaimedRemoval();
  let removed = 0;
  for (const item of items) {
    try {
      await removeItemWithAssets(item);
      removed += 1;
      console.log(`🧹 Авто-удаление объявления #${item.id} «${item.title}»`);
    } catch (err) {
      console.warn(`[nudge] не удалось удалить объявление ${item.id}: ${err.message}`);
    }
  }
  return removed;
}

/** Один проход цикла (напоминания + авто-удаление). */
export async function runUnclaimedCycle(bot, webAppUrl = '') {
  const nudged = await sendUnclaimedNudges(bot, webAppUrl);
  const removed = await removeUnclaimedItems();
  return { nudged, removed };
}

/** Фоновая задача: первый проход через минуту, дальше — каждый час. */
export function startUnclaimedCycle(bot, webAppUrl = '') {
  if (!bot) return;
  const run = () => runUnclaimedCycle(bot, webAppUrl)
    .then((res) => console.log(`🧹 Невостребованные: напоминаний=${res.nudged}, удалено=${res.removed}`))
    .catch((err) => console.warn('Unclaimed cycle failed:', err.message));
  setTimeout(run, 60 * 1000);
  setInterval(run, 60 * 60 * 1000);
}