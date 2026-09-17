import { POINT_TYPES } from '../api';
import Sticker from './Sticker';

const SCOPE_NOTES = {
  oblast: 'В вашем городе подходящих пунктов нет — показаны пункты по области.',
  country: 'Рядом с вашим городом подходящих пунктов нет — показаны пункты по стране.',
};

/**
 * Список маршрутов сдачи (общий для «Разобрать вещи» и «Куда сдать»).
 * route: { routes: [{ point, categories, items, reason, distanceKm }], uncovered: [] }.
 * Если передан onSelectPoint — каждый пункт кликабельный (подробная карточка).
 */
export default function RouteList({ route, onSelectPoint }) {
  if (!route) return null;
  const routes = Array.isArray(route.routes) ? route.routes : [];
  const uncovered = Array.isArray(route.uncovered) ? route.uncovered : [];

  const scopeNote = route.all ? SCOPE_NOTES[route.scope] : null;

  return (
    <div className="space-y-3">
      <p className="type-label">Маршрут сдачи</p>
      {scopeNote && <p className="type-empty">{scopeNote}</p>}
      {routes.length === 0 && (
        <p className="type-empty">Пункт не найден для этих вещей. Можно попробовать поискать отдельно.</p>
      )}
      {routes.map((r) => {
        const info = POINT_TYPES[r.point?.type] || POINT_TYPES.other;
        const subtitle = (r.items?.length ? r.items : r.categories || []).join(', ');
        const content = (
          <>
            <div className="flex items-center gap-2">
              <Sticker name={info.sticker} size={28} />
              <div className="flex-1 min-w-0 text-left">
                <p className="type-title">{r.point?.short_address || r.point?.address || r.point?.name}</p>
                <p className="type-meta">
                  {info.label}
                  {r.distanceKm != null && Number.isFinite(r.distanceKm) && ` · ${r.distanceKm < 1 ? 'рядом' : `${r.distanceKm.toFixed(1)} км`}`}
                </p>
              </div>
              {onSelectPoint && (
                <span className="text-ink/30 text-xl font-black" aria-hidden>›</span>
              )}
            </div>
            {subtitle && <p className="type-body mt-2 text-left">{subtitle}</p>}
          </>
        );

        return onSelectPoint ? (
          <button
            key={r.point?.id}
            type="button"
            onClick={() => onSelectPoint(r.point)}
            className="card p-4 w-full text-left active:scale-[0.99] transition-transform"
          >
            {content}
          </button>
        ) : (
          <div key={r.point?.id} className="card p-4">{content}</div>
        );
      })}
      {routes.length > 0 && (
        <p className="type-kicker">
          Найдено пунктов: {route.all && route.total ? route.total : routes.length}
          {route.truncated ? ` · показаны первые ${routes.length}` : ''}
        </p>
      )}
      {uncovered.length > 0 && (
        <p className="type-empty">
          Пункт не найден для: {uncovered.join(', ')}. Можно попробовать поискать отдельно.
        </p>
      )}
    </div>
  );
}
