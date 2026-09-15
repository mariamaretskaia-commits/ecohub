import { OBLASTS, getSettlements, getDistricts } from './locations';

export function getPosition(timeout = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout, maximumAge: 120000, enableHighAccuracy: false },
    );
  });
}

async function reverseGeocode(lat, lng) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}` +
      `&zoom=18&addressdetails=1&accept-language=ru`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.address || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function firstMatch(values, list) {
  for (const value of values) {
    if (value && list.includes(value)) return value;
  }
  return null;
}

export async function detectLocation() {
  const pos = await getPosition();
  if (!pos) return null;
  const address = await reverseGeocode(pos.lat, pos.lng);
  if (!address) return null;

  const oblast = firstMatch([address.state, address.state_district], OBLASTS) || null;

  const settlementCandidates = [
    address.city,
    address.town,
    address.village,
    address.municipality,
    address.hamlet,
    address.county,
  ].filter(Boolean);

  let settlement = null;
  if (oblast) {
    settlement = firstMatch(settlementCandidates, getSettlements(oblast));
  }

  let district = null;
  if (oblast && settlement) {
    district = firstMatch(
      [address.suburb, address.neighbourhood, address.city_district].filter(Boolean),
      getDistricts(oblast, settlement),
    );
  }

  if (!oblast && !settlement) return null;
  return { oblast, settlement, district, lat: pos.lat, lng: pos.lng };
}