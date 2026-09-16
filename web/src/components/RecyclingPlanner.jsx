import { useState } from 'react';
import { api, RECYCLING_CATEGORIES, POINT_TYPES } from '../api';
import { tg } from '../telegram';
import { getPlace, CITY_DISTRICT_COORDS } from '../belarus-places';
import Sticker from './Sticker';

const MAX_ITEMS = 30;

function parseNames(text) {
  return [...new Set(
    String(text || '')
      .split(/[\n,;/]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  )].slice(0, MAX_ITEMS);
}

/** Координаты выбранной локации (район города точнее общего центра). */
function plannerCoords(loc) {
  if (!loc) return null;
  if (loc.district && loc.settlement) {
    const dc = CITY_DISTRICT_COORDS[loc.settlement];
    const c = dc && dc[loc.district];
    if (c) return c;
  }
  const place = getPlace(loc.oblast, loc.settlement);
  if (place?.lat != null && place?.lng != null) return [place.lat, place.lng];
  return null;
}

/**
 * «Разобрать вещи»: список вещей → категории (Zhipu + словарь) →
 * маршрут по пунктам приёма рядом с выбранной на карте локацией.
 * Не влияет на публикацию в ленте — только планирование.
 */
export default function RecyclingPlanner({ loc = null, onClose, onShowOnMap }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);
  const [route, setRoute] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('list');

  const handleCategorize = async () => {
    const names = parseNames(text);
    if (!names.length) {
      tg.showAlert('Напишите, что хотите разобрать – по одной вещи в строке.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.categorizeItems(names);
      const list = Array.isArray(res.items) ? res.items : [];
      if (!list.length) throw new Error('Не удалось определить категории');
      setItems(list);
      setStage('categorized');
    } catch (err) {
      tg.showAlert(err.message || 'Не удалось разобрать список');
    } finally {
      setBusy(false);
    }
  };

  const changeCategory = (idx, category) => {
    setItems((prev) => prev.map((row, i) => (
      i === idx ? { ...row, category } : row
    )));
  };

  const uniqueCategories = () => [...new Set(items.map((row) => row.category).filter(Boolean))];

  const handleBuildRoute = async () => {
    const categories = uniqueCategories();
    if (!categories.length) {
      tg.showAlert('Выберите хотя бы одну категорию.');
      return;
    }
    setBusy(true);
    try {
      const [lat, lng] = plannerCoords(loc) || [null, null];
      const plan = await api.planRecycling({ categories, lat, lng });
      setRoute(plan);
      setStage('route');
    } catch (err) {
      tg.showAlert(err.message || 'Не удалось построить маршрут');
    } finally {
      setBusy(false);
    }
  };

  const pointTypes = () => {
    if (!route?.routes?.length) return [];
    return [...new Set(route.routes.map((r) => String(r.point?.type || '').trim()).filter(Boolean))];
  };

  const showOnMap = () => {
    const types = pointTypes();
    const first = route?.routes?.[0]?.point;
    onShowOnMap?.(types, first);
  };

  const cats = uniqueCategories();
  const namesCount = parseNames(text).length;

  return (
    <div className="fixed inset-0 z-[200] bg-white px-4 pt-3 pb-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sticker name="share" size={36} alt="разбор вещей" />
          <h2 className="type-brand">Разобрать вещи</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white shadow-soft text-ink/50 text-xl font-black"
        >
          &times;
        </button>
      </div>

      <p className="type-body mb-4 leading-relaxed">
        Напишите, что накопилось, – подскажем, к каким категориям это относится, и построим
        маршрут по точкам, где всё можно сдать. Объявления в ленте это не создаёт и не меняет.
      </p>

      <label className="block mb-3">
        <span className="type-label">Что у вас лежит? – по одной вещи в строке</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="field h-32 resize-none"
          placeholder={'Старая куртка\nТелевизор\nЖурналы'}
        />
        <span className="type-kicker mt-1 block">
          {namesCount}/{MAX_ITEMS} вещей{namesCount >= MAX_ITEMS ? ' – максимум достигнут' : ''}
        </span>
      </label>

      <button
        type="button"
        onClick={handleCategorize}
        disabled={busy}
        className="btn-mint w-full"
      >
        {busy && stage === 'list' ? 'Разбираем...' : 'Разобрать'}
      </button>

      {stage === 'categorized' && (
        <>
          <div className="mt-4 space-y-2">
            {items.map((row, idx) => (
              <div key={`${idx}-${row.name}`} className="card p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="type-title truncate">{row.name}</p>
                  <p className="type-kicker">{row.category}</p>
                </div>
                <select
                  value={row.category}
                  onChange={(e) => changeCategory(idx, e.target.value)}
                  className="field !p-2 text-sm w-36"
                >
                  {RECYCLING_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="sticky bottom-0 -mx-4 mt-4 bg-white px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] border-t border-ink/5">
            <button
              type="button"
              onClick={handleBuildRoute}
              disabled={busy}
              className="btn-primary w-full"
            >
              {busy && stage === 'route' ? 'Строим маршрут...' : 'Построить маршрут сдачи'}
            </button>
          </div>
        </>
      )}

      {stage === 'route' && route && (
        <div className="mt-4 space-y-3">
          <p className="type-label">Маршрут сдачи</p>
          {route.routes.length === 0 && (
            <p className="type-empty">Не удалось подобрать пункты под эти категории.</p>
          )}
          {route.routes.map((r) => {
            const info = POINT_TYPES[r.point?.type] || POINT_TYPES.other;
            return (
              <div key={r.point?.id} className="card p-4">
                <div className="flex items-center gap-2">
                  <Sticker name={info.sticker} size={28} />
                  <div className="flex-1 min-w-0">
                    <p className="type-title">{r.point?.short_address || r.point?.address || r.point?.name}</p>
                    <p className="type-meta">
                      {info.label}
                      {r.distanceKm != null && Number.isFinite(r.distanceKm) && ` · ${r.distanceKm < 1 ? 'рядом' : `${r.distanceKm.toFixed(1)} км`}`}
                    </p>
                  </div>
                </div>
                <p className="type-body mt-2">{r.reason}</p>
                <p className="type-kicker mt-1">{r.categories?.join(', ')}</p>
              </div>
            );
          })}
          {route.uncovered?.length > 0 && (
            <p className="type-empty">
              Не нашли пункты для: {route.uncovered.join(', ')}. Можно попробовать поискать отдельно.
            </p>
          )}
          {cats.length > 0 && (
            <p className="type-kicker">
              Категории маршрута: {cats.join(' · ')}
            </p>
          )}
          {pointTypes().length > 0 && (
            <button type="button" onClick={showOnMap} className="btn-secondary w-full">
              Показать на карте
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-secondary w-full">
            Готово
          </button>
        </div>
      )}
    </div>
  );
}