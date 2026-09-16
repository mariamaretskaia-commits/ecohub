/**
 * Логирование категоризации: пишем каждое название с результатом, чтобы
 * потом (локальный скрипт generate-rules.mjs) самообучал офлайн-словарь.
 * Записи не критичны: сбои молча игнорируются.
 */
import { run } from './db.js';

function safeUserId(user) {
  const id = user?.id ?? user?.telegram_id ?? user;
  return id == null ? null : String(id);
}

/**
 * @param {object} ctx { user, entries: [{name, category, provider, source}] }
 */
export function logCategorization(ctx) {
  const userId = safeUserId(ctx?.user);
  const entries = Array.isArray(ctx?.entries) ? ctx.entries : [];
  for (const e of entries) {
    if (!e?.name || !e?.category) continue;
    void run(
      `INSERT INTO categorization_log (user_telegram_id, name, category, category_rules, provider, corrected)
       VALUES (?, ?, ?, ?, ?, 0)`,
      userId,
      String(e.name),
      String(e.category),
      e.category_rules != null ? String(e.category_rules) : null,
      e.provider != null ? String(e.provider) : null,
    ).catch(() => {});
  }
}

/** Факт ручного исправления пользователем (обратная связь для обучения). */
export function logFix(user, name, category) {
  const userId = safeUserId(user);
  void run(
    `INSERT INTO categorization_log (user_telegram_id, name, category, category_rules, provider, corrected)
     VALUES (?, ?, ?, ?, 'fix', 1)`,
    userId,
    String(name),
    String(category),
    null,
  ).catch(() => {});
}