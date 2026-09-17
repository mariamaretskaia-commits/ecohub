import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api, RECYCLING_CATEGORIES, POINT_TYPES } from '../api';
import { tg } from '../telegram';
import { plannerCoords } from '../planner-coords';
import Sticker from './Sticker';
import RouteList from './RouteList';
import PointDetail from './PointDetail';

const MAX_ITEMS = 30;

function parseNames(text) {
  return [...new Set(
    String(text || '')
      .split(/[\n,;/]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  )].slice(0, MAX_ITEMS);
}

/**
 * «Разобрать вещи»: список вещей → категории (Zhipu + словарь) →
 * маршрут по пунктам приёма рядом с выбранной на карте локацией.
 * Не влияет на публикацию в ленте – только планирование.
 */
export default function RecyclingPlanner({ loc = null, onClose, onShowOnMap }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);
  const [route, setRoute] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('list');
  const [selectedPoint, setSelectedPoint] = useState(null);

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

  const changeCategory = (idx, category, name) => {
    setItems((prev) => prev.map((row, i) => (
      i === idx ? { ...row, category } : row
    )));
    if (name) api.categorizeFix(name, category).catch(() => {});
  };

  const handleBuildRoute = async () => {
    const list = items
      .filter((row) => row.category)
      .map((row) => ({ name: row.name, category: row.category }));
    if (!list.length) {
      tg.showAlert('Выберите хотя бы одну категорию.');
      return;
    }
    setBusy(true);
    try {
      const [lat, lng] = plannerCoords(loc) || [null, null];
      const plan = await api.planRecycling({ items: list, lat, lng });
      setRoute(plan);
      setStage('route');
    } catch (err) {
      tg.showAlert(err.message || 'Не удалось построить маршрут');
    } finally {
      setBusy(false);
    }
  };

  const typesOnMap = route?.routes?.length
    ? [...new Set(route.routes.map((r) => String(r.point?.type || '').trim()).filter(Boolean))]
    : [];
  const firstPoint = route?.routes?.[0]?.point;
  const showOnMap = () => onShowOnMap?.(typesOnMap, firstPoint);

  const namesCount = parseNames(text).length;

  if (selectedPoint) {
    return createPortal(
      <div className="fixed inset-0 z-[200] bg-white overflow-y-auto">
        <PointDetail
          point={selectedPoint}
          onBack={() => setSelectedPoint(null)}
          backLabel="Назад к маршруту"
        />
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-white px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] overflow-y-auto">
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
              <div key={`${idx}-${row.name}`} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="type-title flex-1 min-w-0 break-words">{row.name}</p>
                  {row.pointFound === false && (
                    <span className="type-kicker text-red-500 shrink-0">Пункт не найден</span>
                  )}
                </div>
                <label className="block mt-2">
                  <span className="type-kicker">Категория</span>
                  <select
                    value={row.category}
                    onChange={(e) => changeCategory(idx, e.target.value, row.name)}
                    className="field w-full text-sm mt-1"
                  >
                    {RECYCLING_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleBuildRoute}
            disabled={busy}
            className="btn-primary w-full mt-4"
          >
            {busy && stage === 'route' ? 'Строим маршрут...' : 'Построить маршрут сдачи'}
          </button>
        </>
      )}

      {stage === 'route' && route && (
        <div className="mt-4">
          <RouteList
            route={route}
            onShowOnMap={onShowOnMap ? showOnMap : undefined}
            onSelectPoint={setSelectedPoint}
          />
          <button type="button" onClick={onClose} className="btn-secondary w-full mt-3">
            Готово
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
