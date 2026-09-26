import { useEffect, useState } from 'react';
import { api } from '../api';
import { tg } from '../telegram';
import Sticker from './Sticker';
import ProfileForm from './ProfileForm';
import ItemCard from './ItemCard';
import ItemForm from './ItemForm';

export default function ProfileTab({ user, onRefresh, onGoToFeed }) {
  const [leaderboard, setLeaderboard] = useState([]);
  const [myItems, setMyItems] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [loadingMine, setLoadingMine] = useState(true);
  const [loadingFav, setLoadingFav] = useState(true);
  const [editingItem, setEditingItem] = useState(null);
  const [creating, setCreating] = useState(false);
  const [openMine, setOpenMine] = useState(true);
  const [openFav, setOpenFav] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [togglingNudges, setTogglingNudges] = useState(false);

  const closeCreate = () => {
    setCreating(false);
  };

  const nudgesOff = Boolean(user?.nudges_disabled);

  const handleToggleNudges = async () => {
    if (togglingNudges) return;
    setTogglingNudges(true);
    try {
      await api.setNudges(!nudgesOff);
      onRefresh?.();
    } catch (err) {
      tg.showAlert(err.message || 'Не удалось изменить настройку');
    }
    setTogglingNudges(false);
  };

  const handleExportData = async () => {
    try {
      const { token } = await api.getExportToken();
      const url = `${window.location.origin}/api/me/export/download?token=${encodeURIComponent(token)}`;
      tg.openLink(url);
      tg.showAlert('Ваши данные открываются в браузере и сохранятся в Загрузки.');
    } catch (err) {
      tg.showAlert(err.message || 'Не удалось сформировать архив данных');
    }
  };

  const handleDeleteProfile = async () => {
    const confirmed = await tg.showConfirm('Удалить профиль и все данные безвозвратно?');
    if (!confirmed) return;
    try {
      await api.deleteAccount();
      onRefresh?.();
    } catch (err) {
      tg.showAlert(err.message || 'Не удалось удалить профиль');
    }
  };

  const loadMine = async () => {
    setLoadingMine(true);
    try {
      const data = await api.getItems({ mine: '1' });
      setMyItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    }
    setLoadingMine(false);
  };

  const loadFavorites = async () => {
    setLoadingFav(true);
    try {
      const data = await api.getFavorites();
      setFavorites(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    }
    setLoadingFav(false);
  };

  useEffect(() => {
    api.getLeaderboard()
      .then((data) => setLeaderboard(Array.isArray(data) ? data : []))
      .catch(console.error);
  }, [user?.items_shared]);

  useEffect(() => {
    if (!user?.profile_complete) return;
    loadMine();
    loadFavorites();
  }, [user?.profile_complete, user?.id]);

  if (!user) {
    return (
      <div className="px-4 pt-8 text-center">
        <Sticker name="person" size={72} className="mx-auto mb-3" alt="профиль" />
        <p className="type-title">Откройте EcoHub из Telegram</p>
        <p className="type-body mt-2">Профиль создаётся, когда вы заходите через @EcoHubBY_bot.</p>
      </div>
    );
  }

  if (!user.profile_complete) {
    return (
      <ProfileForm
        user={user}
        onSaved={() => {
          onRefresh?.();
        }}
        intro
      />
    );
  }

  if (creating) {
    return (
      <ItemForm
        onClose={closeCreate}
        onSaved={() => {
          setCreating(false);
          setOpenMine(true);
          loadMine();
          onRefresh?.();
        }}
      />
    );
  }

  if (editingItem) {
    return (
      <ItemForm
        item={editingItem}
        onClose={() => setEditingItem(null)}
        onSaved={() => {
          setEditingItem(null);
          loadMine();
          onRefresh?.();
        }}
      />
    );
  }

  return (
    <div className="px-4 pt-2 pb-8">
      <div className="card p-5 text-center bg-gradient-to-b from-white to-mint-50">
        <Sticker name="person" size={84} className="mx-auto" alt="профиль" />
        <h2 className="type-brand leading-tight mt-2">{user.display_name}</h2>
        <p className="type-body mt-2">
          Здесь ваши объявления и избранное.
          <br />
          Отдать вещь – через «+ Добавить».
        </p>
        {!editingName ? (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="btn-secondary mt-4 px-5 py-2.5"
          >
            Изменить имя
          </button>
        ) : (
          <div className="mt-4 text-left">
            <ProfileForm
              user={user}
              compact
              onSaved={() => {
                setEditingName(false);
                onRefresh?.();
              }}
              onCancel={() => setEditingName(false)}
            />
          </div>
        )}
        <div className="mt-4 pt-3 border-t border-red-100 space-y-2">
          <button
            type="button"
            onClick={handleExportData}
            className="btn-secondary w-full"
          >
            Скачать мои данные
          </button>
          <button
            type="button"
            onClick={handleDeleteProfile}
            className="btn-danger w-full"
          >
            Удалить профиль
          </button>
        </div>
      </div>

      <div className="card p-5 mt-4">
        <h3 className="type-title mb-3">Мои достижения</h3>
        <div className="grid grid-cols-2 gap-3">
          <StatCard value={user.items_shared || 0} label="Вещей отдано" />
          <StatCard value={user.items_taken || 0} label="Вещей взято" />
        </div>
      </div>

      <div className="card p-5 mt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="type-title">Напоминания об объявлениях</h3>
            <p className="type-body mt-1 leading-relaxed">
              Через 14 дней бот напомнит, если вещь никто не забрал, а через 21 день удалит объявление без откликов. Отключите – тогда всё только вручную.
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggleNudges}
            disabled={togglingNudges}
            aria-pressed={!nudgesOff}
            aria-label={nudgesOff ? 'Включить напоминания и авто-удаление' : 'Отключить напоминания и авто-удаление'}
            className="shrink-0 w-16 h-11 rounded-full relative transition-colors cursor-pointer active:scale-95"
            style={{ background: nudgesOff ? '#cbd5e1' : '#66c68a' }}
          >
            <span
              className="absolute top-1.5 w-7 h-7 rounded-full bg-white shadow transition-all pointer-events-none"
              style={{ left: nudgesOff ? 4 : 32 }}
            />
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <CollapsibleSection
          title="Мои объявления"
          sticker="listing"
          count={myItems.length}
          open={openMine}
          onToggle={() => setOpenMine((v) => !v)}
          action={(
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCreating(true);
              }}
              className="shrink-0 h-9 px-3 rounded-full bg-ink text-white text-sm font-extrabold active:scale-95 transition-transform shadow-soft"
              aria-label="Добавить объявление"
            >
              + Добавить
            </button>
          )}
        >
          {loadingMine ? (
            <div className="card p-6 text-center type-empty">Загрузка...</div>
          ) : myItems.length === 0 ? (
            <div className="card p-6 text-center">
              <Sticker name="listing" size={64} className="mx-auto mb-2" alt="объявление" />
              <p className="type-title">Пока пусто</p>
              <p className="type-body mt-1 mb-4">
                Добавьте объявление – его увидят в разделе «Даром».
              </p>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="btn-primary w-full py-3"
              >
                Добавить объявление
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {myItems.map((row) => (
                <ItemCard
                  key={row.id}
                  item={row}
                  currentUser={user}
                  ownerMode
                  onEdit={setEditingItem}
                  onUpdate={() => {
                    loadMine();
                    onRefresh?.();
                  }}
                />
              ))}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Избранное"
          sticker="favorite"
          count={favorites.length}
          open={openFav}
          onToggle={() => setOpenFav((v) => !v)}
        >
          {loadingFav ? (
            <div className="card p-6 text-center type-empty">Загрузка...</div>
          ) : favorites.length === 0 ? (
            <div className="card p-6 text-center">
              <Sticker name="favorite" size={64} className="mx-auto mb-2" alt="избранное" />
              <p className="type-body mb-4">
                Отмечайте понравившиеся объявления значком в разделе «Даром» – они появятся здесь.
              </p>
              <button
                type="button"
                onClick={onGoToFeed}
                className="btn-primary w-full py-3"
              >
                Перейти к объявлениям
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {favorites.map((row) => (
                <ItemCard
                  key={row.id}
                  item={row}
                  currentUser={user}
                  favoriteMode
                  onNeedProfile={() => onRefresh?.()}
                  onUpdate={() => {
                    loadFavorites();
                    onRefresh?.();
                  }}
                />
              ))}
            </div>
          )}
        </CollapsibleSection>
      </div>

      <div className="card p-5 mt-4">
        <h3 className="type-title mb-3">Топ 5 дарителей</h3>
        {leaderboard.length === 0 ? (
          <p className="type-empty">Пока никто не отметил вещь как отданную</p>
        ) : (
          <div className="space-y-2">
            {leaderboard.slice(0, 5).map((u, i) => (
              <div key={u.id} className="flex items-center gap-3 py-2">
                <div className="flex items-center gap-1 shrink-0">
                  {i < 3 && (
                    <Sticker
                      name={['crownGold', 'crownSilver', 'crownBronze'][i]}
                      size={22}
                      alt=""
                    />
                  )}
                  <span className="w-7 h-7 rounded-full bg-mint-100 text-mint-700 text-xs font-black flex items-center justify-center">
                    {i + 1}
                  </span>
                </div>
                <span className="flex-1 type-title">{u.display_name || u.first_name}</span>
                <span className="type-kicker">{u.items_shared}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {user.moderator && <ModeratorPanel />}
    </div>
  );
}

function CollapsibleSection({ title, sticker, count, open, onToggle, action, children }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-3 min-w-0 flex-1 py-1 text-left active:bg-mint-50/60 rounded-xl transition-colors"
          aria-expanded={open}
        >
          <Sticker name={sticker} size={36} alt="" />
          <span className="type-title truncate">{title}</span>
        </button>
        {action}
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 flex items-center gap-2 py-1 pl-1 pr-0.5 rounded-xl active:bg-mint-50/60 transition-colors"
          aria-expanded={open}
          aria-label={open ? 'Свернуть' : 'Развернуть'}
        >
          <span className="type-kicker tabular-nums">{count}</span>
          <span
            className={`text-mint-700 text-lg leading-none transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          >
            ▾
          </span>
        </button>
      </div>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-mint-100/80">
          {children}
        </div>
      )}
    </div>
  );
}

function StatCard({ value, label }) {
  return (
    <div className="bg-mint-50 rounded-[1.25rem] p-3 text-center">
      <div className="type-brand">{value}</div>
      <div className="type-meta mt-0.5">{label}</div>
    </div>
  );
}

function ModeratorPanel() {
  const [banned, setBanned] = useState([]);
  const [loading, setLoading] = useState(true);
  const [idInput, setIdInput] = useState('');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const data = await api.getModeratorBanned();
      setBanned(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      tg.showAlert(err.message || 'Не удалось загрузить список блокировок');
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const name = (b) =>
    b.nickname || [b.first_name, b.last_name].filter(Boolean).join(' ') || '—';

  const formatDate = (v) => {
    if (!v) return '';
    return String(v).slice(0, 10);
  };

  const handleUnban = async (telegramId) => {
    const confirmed = await tg.showConfirm(`Разблокировать пользователя ${telegramId}?`);
    if (!confirmed) return;
    setBusy(true);
    try {
      await api.moderatorUnban(telegramId);
      tg.showAlert('Пользователь разблокирован.');
      await load();
    } catch (err) {
      tg.showAlert(err.message || 'Не удалось разблокировать');
    }
    setBusy(false);
  };

  const handleBan = async () => {
    const tid = String(idInput || '').trim();
    if (!tid) {
      tg.showAlert('Введите Telegram ID пользователя.');
      return;
    }
    const daysNum = Number(days);
    const confirmed = await tg.showConfirm(
      `Заблокировать пользователя ${tid}${daysNum > 0 ? ` на ${daysNum} дн.` : ' навсегда'}?`,
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await api.moderatorBan(tid, String(reason || '').trim() || 'Блокировка модератором', daysNum > 0 ? daysNum : null);
      tg.showAlert('Пользователь заблокирован.');
      setIdInput('');
      setReason('');
      setDays('');
      await load();
    } catch (err) {
      tg.showAlert(err.message || 'Не удалось заблокировать');
    }
    setBusy(false);
  };

  return (
    <div className="card p-5 mt-4 border-2 border-red-200">
      <h3 className="type-title mb-1">Модерация</h3>
      <p className="type-body mb-3">
        Блокировка ограничивает публикацию объявлений и сообщений в чатах.
      </p>

      <div className="space-y-2 mb-3">
        <input
          type="text"
          inputMode="numeric"
          value={idInput}
          onChange={(e) => setIdInput(e.target.value)}
          placeholder="Telegram ID пользователя"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mint-400"
        />
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Причина (необязательно)"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mint-400"
        />
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="Дней (пусто = навсегда)"
            className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mint-400"
          />
          <button
            type="button"
            onClick={handleBan}
            disabled={busy}
            className="btn-danger shrink-0 px-4 py-2"
          >
            Заблокировать
          </button>
        </div>
      </div>

      <h4 className="type-meta uppercase tracking-wide mb-2">Заблокированные</h4>
      {loading ? (
        <p className="type-empty">Загрузка...</p>
      ) : banned.length === 0 ? (
        <p className="type-empty">Заблокированных нет</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {banned.map((b) => (
            <div key={b.telegram_id} className="rounded-xl bg-red-50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="type-title text-sm truncate">{name(b)}</p>
                  <p className="type-meta truncate">Telegram ID: {b.telegram_id}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleUnban(b.telegram_id)}
                  disabled={busy}
                  className="shrink-0 rounded-full bg-ink text-white text-xs font-extrabold px-3 py-1.5 active:scale-95 transition-transform"
                >
                  Разблокировать
                </button>
              </div>
              {b.reason && <p className="type-meta mt-1 truncate">Причина: {b.reason}</p>}
              <p className="type-meta">
                С {formatDate(b.created_at)}
                {b.expires_at ? ` до ${formatDate(b.expires_at)}` : ' · навсегда'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
