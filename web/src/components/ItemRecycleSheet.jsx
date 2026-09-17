import { useEffect, useState } from 'react';
import { api } from '../api';
import { tg } from '../telegram';
import { plannerCoords } from '../planner-coords';
import RouteList from './RouteList';

/**
 * «Куда сдать» для своего объявления: строит маршрут по названию и категории вещи.
 * Если вид вещи не входит в перечень приёма ни одного пункта – честно «Пункт не найден».
 */
export default function ItemRecycleSheet({ item, onClose }) {
  const [route, setRoute] = useState(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [lat, lng] = plannerCoords({
          oblast: item?.oblast,
          settlement: item?.settlement,
          district: item?.district,
        }) || [null, null];
        const plan = await api.planRecycling({
          items: [{ name: item?.title, category: item?.category }],
          lat,
          lng,
        });
        if (alive) setRoute(plan);
      } catch (err) {
        if (alive) tg.showAlert(err.message || 'Не удалось построить маршрут');
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [item?.id]);

  return (
    <div className="fixed inset-0 z-[210] bg-white px-4 pt-3 pb-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h2 className="type-brand">Куда сдать</h2>
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white shadow-soft text-ink/50 text-xl font-black"
        >
          &times;
        </button>
      </div>

      <p className="type-title truncate">{item?.title}</p>
      <p className="type-kicker mb-4">{item?.category}</p>

      {busy ? (
        <p className="type-empty">Ищем пункты приёма...</p>
      ) : (
        <RouteList route={route} />
      )}

      <button type="button" onClick={onClose} className="btn-secondary w-full mt-4">
        Готово
      </button>
    </div>
  );
}
