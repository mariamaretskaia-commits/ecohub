/** Always-on basemap: OSM/Carto raster. Street language follows OSM (BY often be) – OK.
 *  App labels (cities, districts, point addresses) stay Russian in our UI.
 */

const cartoKey = String(import.meta.env.VITE_CARTO_API_KEY || '').trim();

const OSM_TILE = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap',
  subdomains: 'abc',
  maxNativeZoom: 19,
};

const CARTO_TILE = {
  url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${cartoKey ? `?key=${cartoKey}` : ''}`,
  attribution: '© OpenStreetMap © CARTO',
  subdomains: 'abcd',
  maxNativeZoom: 20,
};

export const MAP_TILE = cartoKey ? CARTO_TILE : OSM_TILE;
