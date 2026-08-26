import { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { api, POINT_TYPES } from '../api';
import { PLACES, getPlace, BELARUS_CENTER, BELARUS_BOUNDS, CITY_DISTRICT_COORDS } from '../belarus-places';
import oblastsGeo from '../data/belarus-oblasts.json';
import LocationSelect from './LocationSelect';
import PointDetail from './PointDetail';
import Sticker, { STICKERS } from './Sticker';
import { sortByRelevance, relevanceHint } from '../point-rank';
import { accessInfo } from '../point-access';
import { MAP_TILE } from '../map-tiles';

const GRODNO_BOUNDS = [
  [53.60, 23.71],
  [53.76, 23.94],
];

const DISTRICT_BOUNDS = {
  Ленинский: [[53.678, 23.79], [53.76, 23.88]],
  Октябрьский: [[53.60, 23.72], [53.695, 23.93]],
};

const MAJOR_CITIES = new Set([
  'Минск', 'Брест', 'Гродно', 'Гомель', 'Витебск', 'Могилёв',
  'Барановичи', 'Борисов', 'Пинск', 'Орша', 'Мозырь', 'Лида',
  'Полоцк', 'Новополоцк', 'Солигорск', 'Молодечно', 'Бобруйск',
]);

function acceptsType(point, type) {
  if (!type) return true;
  if (point.type === type) return true;
  return String(point.accepts || '').split(',').map((item) => item.trim()).includes(type);
}

function createIcon(point, active) {
  const info = POINT_TYPES[point.type] || POINT_TYPES.paper;
  const src = STICKERS[info.sticker] || STICKERS.paper;
  const label = point.short_address || point.address || '';
  return L.divIcon({
    className: `point-marker-wrap${active ? ' is-focus' : ''}`,
    html: `<div class="point-marker${active ? ' is-focus' : ''}">
      <img src="${src}" alt="${info.label}" />
      <span>${label}</span>
    </div>`,
    iconSize: [168, 40],
    iconAnchor: [18, 20],
  });
}

function MapReady() {
  const map = useMap();
  useEffect(() => {
    const sync = () => map.invalidateSize();
    const timer = setTimeout(sync, 120);
    window.addEventListener('resize', sync);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', sync);
    };
  }, [map]);
  return null;
}

function zoomBand(z) {
  if (z < 7) return 0;
  if (z < 9) return 1;
  if (z < 10) return 2;
  if (z < 11) return 3;
  if (z < 12) return 4;
  return 5;
}

function MapZoom({ onZoom }) {
  const map = useMap();
  const bandRef = useRef(null);
  const report = () => {
    const z = map.getZoom();
    const band = zoomBand(z);
    if (bandRef.current === band) return;
    bandRef.current = band;
    onZoom(z);
    if (map.zoomControl) {
      map.zoomControl._zoomInButton.title = 'Приблизить';
      map.zoomControl._zoomOutButton.title = 'Отдалить';
    }
  };
  useEffect(report, [map, onZoom]);
  useMapEvents({ zoomend: report });
  return null;
}

function MapFly({ loc, focusPoint }) {
  const map = useMap();
  const flownKey = useRef('');
  const booted = useRef(false);

  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      map.fitBounds(BELARUS_BOUNDS, { padding: [12, 12], maxZoom: 7, animate: false });
      return;
    }

    const district = loc.districts?.[0] || loc.district || '';
    const focusId = focusPoint?.id || `${focusPoint?.lat || ''}:${focusPoint?.lng || ''}`;
    const key = `${loc.oblast}|${loc.settlement}|${district}|${focusId}`;
    if (flownKey.current === key) return;
    flownKey.current = key;

    if (focusPoint?.lat && focusPoint?.lng) {
      map.flyTo([Number(focusPoint.lat), Number(focusPoint.lng)], 16, { duration: 0.35 });
      return;
    }
    if (loc.settlement === 'Гродно' && district) {
      map.fitBounds(DISTRICT_BOUNDS[district] || GRODNO_BOUNDS, { padding: [28, 28], maxZoom: 13, animate: true });
      return;
    }
    if (loc.settlement) {
      const place = getPlace(loc.oblast, loc.settlement);
      if (place) map.flyTo([place.lat, place.lng], 12, { duration: 0.4 });
      return;
    }
    if (loc.oblast) {
      const feature = oblastsGeo.features.find((item) => item.properties.name === loc.oblast);
      if (feature) {
        map.fitBounds(L.geoJSON(feature).getBounds(), { padding: [24, 24], maxZoom: 8, animate: true });
        return;
      }
    }
    map.fitBounds(BELARUS_BOUNDS, { padding: [12, 12], maxZoom: 7, animate: true });
  }, [map, loc.oblast, loc.settlement, loc.district, loc.districts, focusPoint]);

  return null;
}

export default function MapTab() {
  const [allPoints, setAllPoints] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [filterType, setFilterType] = useState('');
  const [loc, setLoc] = useState({
    oblast: 'Гродненская область',
    settlement: 'Гродно',
    district: '',
    districts: [],
  });
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [loading, setLoading] = useState(true);
  const [focusPoint, setFocusPoint] = useState(null);
  const [zoom, setZoom] = useState(7);
  const zoomRef = useRef(7);
  zoomRef.current = zoom;

  const loadPoints = (silent = false) => {
    if (!silent) {
      setLoading(true);
      setLoadError('');
    }
    api.getPoints()
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setAllPoints(list);
        setSelectedPoint((prev) => (prev ? list.find((p) => p.id === prev.id) || prev : prev));
        if (!list.length && !silent) {
          setLoadError('Пункты не пришли с сервера. Проверьте, что API запущен на порту 3001.');
        }
      })
      .catch((err) => {
        if (!silent) {
          setAllPoints([]);
          setLoadError(err.message || 'Не удалось загрузить пункты');
        }
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };

  useEffect(() => {
    loadPoints();
    const timer = setInterval(() => loadPoints(true), 10 * 60 * 1000);
    const onVis = () => {
      if (document.visibilityState === 'visible') loadPoints(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const points = useMemo(() => {
    const filtered = allPoints.filter((point) => {
      const oblast = point.oblast || 'Гродненская область';
      const settlement = point.settlement || 'Гродно';
      if (loc.oblast && oblast !== loc.oblast) return false;
      if (loc.settlement && settlement !== loc.settlement) return false;
      if (loc.districts?.length && !loc.districts.includes(point.district)) return false;
      if (!acceptsType(point, filterType)) return false;
      return Number(point.lat) && Number(point.lng);
    });
    return sortByRelevance(filtered, filterType);
  }, [allPoints, loc, filterType]);

  const showGrodnoDistricts = loc.settlement === 'Гродно';
  const needTypeFirst = showGrodnoDistricts && !filterType;
  const hideMarkersForCountryZoom = !loc.settlement && zoom < 9;
  const mapPoints = needTypeFirst || hideMarkersForCountryZoom ? [] : points;
  const showOblasts = zoom < 10;
  const showCities = zoom >= 7 && zoom < 12;
  const districtPins = showGrodnoDistricts && zoom >= 11 && needTypeFirst
    ? (CITY_DISTRICT_COORDS.Гродно || {})
    : {};
  const cityPins = showCities
    ? PLACES.filter((place) => (
      MAJOR_CITIES.has(place.settlement)
      || (loc.oblast && place.oblast === loc.oblast && zoom >= 9)
    ))
    : [];

  const changeLoc = (next) => {
    setFocusPoint(null);
    setLoc((prev) => ({
      ...prev,
      ...next,
      districts: next.districts ?? prev.districts ?? [],
    }));
  };

  if (selectedPoint) {
    return (
      <PointDetail
        point={selectedPoint}
        onBack={() => setSelectedPoint(null)}
      />
    );
  }

  return (
    <div>
      <div className="px-4 pt-2 pb-2">
        <div className="card p-4 mb-4 bg-gradient-to-br from-mint-100 to-sun-50">
          <div className="flex items-center gap-3">
            <Sticker name="pin" size={64} alt="карта" />
            <div>
              <h2 className="type-brand leading-tight">Карта Беларуси</h2>
              <p className="type-meta mt-1.5">Пункты сортировки и приёма сырья</p>
            </div>
          </div>
        </div>
        <LocationSelect
          oblast={loc.oblast}
          settlement={loc.settlement}
          district={loc.district}
          districts={loc.districts}
          onChange={changeLoc}
          allowEmpty
          multiDistrict
          compact
        />
      </div>

      <div className="px-4 pt-1">
        <p className="type-label">Что хотите сдать или взять</p>
      </div>
      <div className="flex flex-wrap gap-2 px-4 py-2">
        {!showGrodnoDistricts && (
          <button
            type="button"
            onClick={() => { setFilterType(''); setFocusPoint(null); }}
            className={`filter-chip ${!filterType ? 'filter-chip-active' : 'filter-chip-inactive'}`}
          >
            Все типы
          </button>
        )}
        {Object.entries(POINT_TYPES).map(([key, val]) => (
          <button
            type="button"
            key={key}
            onClick={() => { setFilterType(filterType === key ? '' : key); setFocusPoint(null); }}
            className={`filter-chip ${filterType === key ? 'filter-chip-active' : 'filter-chip-inactive'}`}
          >
            <Sticker name={val.sticker} size={20} className="shrink-0 !drop-shadow-none" />
            <span className="leading-none">{val.label}</span>
          </button>
        ))}
      </div>

      <div className="h-[min(58vh,520px)] min-h-[360px] mx-4 rounded-[1.75rem] overflow-hidden shadow-card border-4 border-white">
        {loading ? (
          <div className="h-full flex items-center justify-center type-empty">Загрузка карты...</div>
        ) : (
          <MapContainer
            center={BELARUS_CENTER}
            zoom={7}
            minZoom={6}
            maxZoom={18}
            maxBounds={BELARUS_BOUNDS}
            maxBoundsViscosity={0.4}
            zoomControl
            scrollWheelZoom
            touchZoom
            doubleClickZoom
            dragging
            preferCanvas
            fadeAnimation={false}
            markerZoomAnimation={false}
            attributionControl={false}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution={MAP_TILE.attribution}
              url={MAP_TILE.url}
              maxZoom={18}
              maxNativeZoom={MAP_TILE.maxNativeZoom}
              {...(MAP_TILE.subdomains ? { subdomains: MAP_TILE.subdomains } : {})}
              updateWhenIdle
              updateWhenZooming={false}
              keepBuffer={1}
            />
            <GeoJSON
              data={oblastsGeo}
              style={(feature) => ({
                color: feature.properties.name === loc.oblast ? '#147a3e' : '#2fb66a',
                weight: feature.properties.name === loc.oblast ? 2 : 1,
                fillColor: '#9ad4b0',
                fillOpacity: feature.properties.name === loc.oblast ? 0.16 : 0.06,
              })}
              onEachFeature={(feature, layer) => {
                layer.on('click', () => {
                  if (zoomRef.current >= 9) return;
                  changeLoc({
                    oblast: feature.properties.name,
                    settlement: feature.properties.name === 'г. Минск' ? 'Минск' : '',
                    district: '',
                    districts: [],
                  });
                });
              }}
            />
            <MapReady />
            <MapZoom onZoom={setZoom} />
            <MapFly loc={loc} focusPoint={focusPoint} />
            {showOblasts && oblastsGeo.features.map((feature) => (
              <Marker
                key={feature.properties.iso}
                position={[feature.properties.lat, feature.properties.lng]}
                icon={L.divIcon({
                  className: 'map-label-wrap',
                  html: `<span class="map-label map-label-oblast">${feature.properties.name}</span>`,
                  iconSize: [0, 0],
                })}
                interactive={false}
              />
            ))}
            {cityPins.map((p) => (
              <Marker
                key={`${p.oblast}-${p.settlement}`}
                position={[p.lat, p.lng]}
                icon={L.divIcon({
                  className: 'map-label-wrap',
                  html: `<span class="map-label map-label-city">${p.settlement}</span>`,
                  iconSize: [0, 0],
                })}
                eventHandlers={{
                  click: () => changeLoc({ oblast: p.oblast, settlement: p.settlement, district: '', districts: [] }),
                }}
              />
            ))}
            {Object.entries(districtPins).map(([name, coords]) => (
              <Marker
                key={`d-${name}`}
                position={coords}
                icon={L.divIcon({
                  className: 'map-label-wrap',
                  html: `<span class="map-label map-label-district${(loc.districts || []).includes(name) ? ' is-active' : ''}">${name} район</span>`,
                  iconSize: [0, 0],
                })}
                eventHandlers={{
                  click: (event) => {
                    L.DomEvent.stopPropagation(event);
                    setFocusPoint(null);
                    setLoc((prev) => {
                      const districts = prev.districts || [];
                      const same = districts.length === 1 && districts[0] === name;
                      return { ...prev, district: same ? '' : name, districts: same ? [] : [name] };
                    });
                  },
                }}
              />
            ))}
            {mapPoints.map((p) => (
              <Marker
                key={p.id}
                position={[Number(p.lat), Number(p.lng)]}
                icon={createIcon(p, focusPoint?.id === p.id)}
                zIndexOffset={focusPoint?.id === p.id ? 800 : 500}
                eventHandlers={{ click: () => setSelectedPoint(p) }}
              >
                <Popup>
                  <strong>{p.name}</strong>
                  <br />
                  {p.short_address || p.address}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}
      </div>
      <p className="type-kicker text-center px-4 mt-1 opacity-70">{MAP_TILE.attribution}</p>

      {loadError && (
        <div className="px-4 pt-2">
          <p className="type-meta text-red-500">{loadError}</p>
          <button type="button" onClick={() => loadPoints()} className="type-kicker">Обновить</button>
        </div>
      )}

      <div className="px-4 py-3 pb-4">
        {needTypeFirst ? (
          <p className="type-kicker">
            Выберите тип – на карте появятся точки, снизу список адресов
          </p>
        ) : (
          <>
            <p className="type-label">
              Адреса
              <span className="ml-2 type-kicker">{points.length}</span>
            </p>
            <p className="type-kicker mb-2">Сначала выгоднее и удобнее сдать</p>
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {points.length === 0 && (
                <p className="type-empty">
                  {loc.settlement && loc.settlement !== 'Гродно'
                    ? `Пункты в городе ${loc.settlement} появятся следующим этапом.`
                    : 'В этом районе пока нет пунктов такого типа.'}
                </p>
              )}
              {points.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => { setFocusPoint(p); setSelectedPoint(p); }}
                  className={`w-full card p-3 text-left flex items-start gap-2 ${focusPoint?.id === p.id ? 'ring-2 ring-mint-400' : ''}`}
                >
                  <Sticker name={POINT_TYPES[p.type]?.sticker || 'pin'} size={28} />
                  <div className="flex-1 min-w-0">
                    <p className="type-title truncate">
                      {p.short_address || p.address}
                    </p>
                    <p className="type-meta">{accessInfo(p).label} · {p.district} район · {p.organization}</p>
                    {relevanceHint(p, filterType) && (
                      <p className="type-kicker mt-0.5">{relevanceHint(p, filterType)}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
