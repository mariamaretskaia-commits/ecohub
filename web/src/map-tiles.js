/** Map basemap config. MapTiler vector layer = real Russian labels; raster ?language=ru is ignored. */
const cartoKey = String(import.meta.env.VITE_CARTO_API_KEY || '').trim();
export const MAPTILER_KEY = String(import.meta.env.VITE_MAPTILER_KEY || '').trim();
export const USE_MAPTILER_VECTOR = Boolean(MAPTILER_KEY);

/** @type {{ url: string; attribution: string; subdomains?: string; maxNativeZoom: number }} */
export const MAP_TILE = (() => {
  if (MAPTILER_KEY) {
    return {
      url: '',
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
