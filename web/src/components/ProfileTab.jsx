import { useEffect, useState } from 'react';
import { api } from '../api';
import Sticker from './Sticker';
import ProfileForm from './ProfileForm';
import ItemCard from './ItemCard';
import ItemForm from './ItemForm';

export default function ProfileTab({ user, onRefresh }) {
  const [leaderboard, setLeaderboard] = useState([]);
  const [myItems, setMyItems] = useState([]);
  const [loadingMine, setLoadingMine] = useState(true);
  const [editingItem, setEditingItem] = useState(null);

  const loadMine = async () => {
    setLoadingMine(true);
    try {
      const data = await api.getItems({ mine: '1' });
      setMyItems(data);
    } catch (e) {
      console.error(e);
    }
    setLoadingMine(false);
  };

  useEffect(() => {
    api.getLeaderboard().then(setLeaderboard).catch(console.error);
  }, [user?.items_shared]);

  useEffect(() => {
    if (!user?.profile_complete) return;
    loadMine();
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
    return <ProfileForm user={user} onSaved={onRefresh} intro />;
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
      </div>

      <div className="card p-5 mt-4">
        <h3 className="type-title mb-3">Круг вещей</h3>
        <div className="grid grid-cols-2 gap-3">
          <StatCard value={user.items_shared || 0} label="Вещей отдано" />
          <StatCard value={user.items_taken || 0} label="Вещей взято" />
        </div>
        <p className="type-meta mt-3">
          Это дневник, не валюта. Пункты на карте платят живыми рублями по своему прайсу.
        </p>
      </div>

      <div className="mt-4">
        <h3 className="type-title mb-3 px-1">Мои объявления</h3>
        {loadingMine ? (
          <div className="card p-6 text-center type-empty">Загрузка...</div>
        ) : myItems.length === 0 ? (
          <div className="card p-6 text-center">
            <Sticker name="listing" size={64} className="mx-auto mb-2" alt="объявление" />
            <p className="type-body">Пока нет активных объявлений. Добавьте вещь во вкладке Даром (+).</p>
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

function StatCard({ value, label }) {
  return (
    <div className="bg-mint-50 rounded-[1.25rem] p-3 text-center">
      <div className="type-brand">{value}</div>
      <div className="type-meta mt-0.5">{label}</div>
    </div>
  );
}
