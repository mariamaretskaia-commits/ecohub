import { getPlace, CITY_DISTRICT_COORDS } from './belarus-places';

/**
 * Координаты выбранной локации (район города точнее общего центра).
 * loc: { oblast, settlement, district }.
 */
export function plannerCoords(loc) {
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
