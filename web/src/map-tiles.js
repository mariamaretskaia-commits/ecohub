/** Map basemap: Russian labels with MapTiler key; otherwise OSM (Cyrillic in BY). */
const cartoKey = String(import.meta.env.VITE_CARTO_API_KEY || '').trim();
const maptilerKey = String(import.meta.env.VITE_MAPTILER_KEY || '').trim();

/** @type {{ url: string; attribution: string; subdomains?: string; maxNativeZoom: number }} */
export const MAP_TILE = (() => {
  if (maptilerKey) {
    return {
      url: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${maptilerKey}&language=ru`,
      attribution: '© MapTiler © OpenStreetMap',
      maxNativeZoom: 19,
    };
  }
  if (cartoKey) {
    return {
      url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${cartoKey}`,
      attribution: '© OpenStreetMap © CARTO',
      subdomains: 'abcd',
      maxNativeZoom: 20,
    };
  }
  return {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    subdomains: 'abc',
    maxNativeZoom: 19,
  };
})();
