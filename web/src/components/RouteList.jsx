import { POINT_TYPES } from '../api';
import Sticker from './Sticker';

/**
 * Список маршрутов сдачи (общий для «Разобрать вещи» и «Куда сдать»).
 * route: { routes: [{ point, categories, items, reason, distanceKm }], uncovered: [] }.
 */
export default function RouteList({ route, onShowOnMap }) {
  if (!route) return null;
  const routes = Array.isArray(route.routes) ? route.routes : [];
  const uncovered = Array.isArray(route.uncovered) ? route.uncovered : [];
  const types = [...new Set(routes.map((r) => String(r.point?.type || '').trim()).filter(Boolean))];

  const showOnMap = () => {
    const first = routes[0]?.point;
    onShowOnMap?.(types, first);
  };

  return (
    <div className="space-y-3">
      <p className="type-label">Маршрут сдачи</p>
      {routes.length === 0 && (
        <p className="type-empty">Пункт не найден для этих вещей. Можно попробовать поискать отдельно.</p>
      )}
      {routes.map((r) => {
        const info = POINT_TYPES[r.point?.type] || POINT_TYPES.other;
        const subtitle = (r.items?.length ? r.items : r.categories || []).join(', ');
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
            {subtitle && <p className="type-body mt-2">{subtitle}</p>}
          </div>
        );
      })}
      {routes.length > 0 && (
        <p className="type-kicker">Найдено пунктов: {routes.length}</p>
      )}
      {uncovered.length > 0 && (
        <p className="type-empty">
          Пункт не найден для: {uncovered.join(', ')}. Можно попробовать поискать отдельно.
        </p>
      )}
      {onShowOnMap && types.length > 0 && (
        <button type="button" onClick={showOnMap} className="btn-secondary w-full">
          Показать на карте
        </button>
      )}
    </div>
  );
}
