/**
 * Гейт блокировки: 403 для заблокированных пользователей на приватных роутах.
 * Карта (/api/points), «О проекте», /api/me, экспорт и удаление профиля
 * остаются доступными.
 */
import { isBanned } from './trust/store.js';

/** Возвращает true, если бан активен (ответ 403 уже отправлен). */
export async function rejectIfBanned(user, res) {
  if (!user?.telegram_id) return false;
  const banned = await isBanned(user.telegram_id);
  if (!banned) return false;
  res.status(403).json({
    error: 'Ваш аккаунт заблокирован. Доступны только разделы «Карта» и «О проекте».',
    banned: true,
  });
  return true;
}