import { useEffect, useState } from 'react';
import { api } from '../api';
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
        onClose={() => setCreating(false)}
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
        <p className="type-meta mt-2">
          Профиль привязан к этому Telegram. Другой аккаунт – другой профиль.
        </p>
        <p className="type-meta mt-1">
          Уведомления об откликах – в чате @EcoHubBY_bot. Включите звук в настройках чата.
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
      </div>

      <div className="card p-5 mt-4">
        <h3 className="type-title mb-3">Мои достижения</h3>
        <div className="grid grid-cols-2 gap-3">
          <StatCard value={user.items_shared || 0} label="Вещей отдано" />
          <StatCard value={user.items_taken || 0} label="Вещей взято" />
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
              <p className="type-body mb-4">Пока нет активных объявлений.</p>
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
