import { useState, useEffect } from 'react';
import { api, CATEGORIES } from '../api';
import ItemCard from './ItemCard';
import ItemForm from './ItemForm';
import Sticker from './Sticker';
import LocationSelect from './LocationSelect';

export default function FeedTab({ user, onRefresh, onNeedProfile }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterLocation, setFilterLocation] = useState({ oblast: '', settlement: '', district: '' });
  const [filterCategory, setFilterCategory] = useState('');
  const [search, setSearch] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [showForm, setShowForm] = useState(false);

  const loadItems = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterLocation.oblast) params.oblast = filterLocation.oblast;
      if (filterLocation.settlement) params.settlement = filterLocation.settlement;
      if (filterLocation.district) params.district = filterLocation.district;
      if (filterCategory) params.category = filterCategory;
      if (searchQ) params.q = searchQ;
      const data = await api.getItems(params);
      setItems(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    const t = setTimeout(() => setSearchQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    loadItems();
  }, [filterLocation.oblast, filterLocation.settlement, filterLocation.district, filterCategory, searchQ]);

  const handleCreated = () => {
    setShowForm(false);
    loadItems();
    onRefresh?.();
  };

  if (showForm) {
    return <ItemForm onClose={() => setShowForm(false)} onSaved={handleCreated} />;
  }

  const emptyTitle = searchQ ? 'Ничего не нашли' : 'Пока пусто';
  const emptyHint = searchQ
    ? 'Попробуйте другое слово в описании'
    : 'Нажмите +, чтобы добавить вещь. Свои объявления – во вкладке Профиль.';

  return (
    <div className="px-4 pt-2">
      <div className="card p-4 mb-4 bg-gradient-to-br from-mint-100 to-sun-50">
        <div className="flex items-center gap-3">
          <Sticker name="share" size={64} alt="передача вещи" />
          <div>
            <p className="type-kicker">Лента объявлений</p>
            <h2 className="type-brand mt-1 leading-tight">Предложения от пользователей</h2>
            <p className="type-meta mt-1.5">Только даром. Сортировка сырья и контейнеры – на карте.</p>
          </div>
        </div>
      </div>

      <div className="card p-4 mb-4 space-y-3">
        <LocationSelect
          oblast={filterLocation.oblast}
          settlement={filterLocation.settlement}
          district={filterLocation.district}
          onChange={setFilterLocation}
          allowEmpty
        />

        <label className="block">
          <span className="type-label">Категория</span>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="field"
          >
            <option value="">Любая категория</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="type-label">Поиск по описанию</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="field"
            placeholder="Например: платье"
            autoComplete="off"
          />
        </label>
      </div>

      {loading ? (
        <div className="text-center py-12 type-empty">Загрузка...</div>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center">
          <Sticker name="listing" size={88} className="mx-auto mb-3" alt="объявление" />
          <p className="type-title">{emptyTitle}</p>
          <p className="type-body mt-1">{emptyHint}</p>
        </div>
      ) : (
        <div className="space-y-4 pb-6">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              currentUser={user}
              onUpdate={() => {
                loadItems();
                onRefresh?.();
              }}
              onNeedProfile={onNeedProfile}
            />
          ))}
        </div>
      )}

      <button
        onClick={() => {
          if (!user?.profile_complete) {
            onNeedProfile?.();
            return;
          }
          setShowForm(true);
        }}
        className="fixed bottom-28 right-5 w-16 h-16 bg-ink text-white rounded-full shadow-float flex items-center justify-center text-3xl font-black active:scale-90 transition-transform z-40"
        aria-label="Поделиться вещью"
      >
        +
      </button>
    </div>
  );
}
