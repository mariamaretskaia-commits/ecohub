import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REGION_POINTS } from '../src/points-regions.js';
import { POINTS } from '../src/points-data.js';
import { BELARUS } from '../../web/src/locations.js';

const OUT = path.join(tmpdir(), 'ecohub-geo');
mkdirSync(OUT, { recursive: true });
const LOCSRC = fileURLToPath(new URL('../../web/src/locations.js', import.meta.url));
const BP_SRC = fileURLToPath(new URL('../../web/src/belarus-places.js', import.meta.url));
const BP_COPY = path.join(OUT, 'belarus-places-research.mjs');
if (!existsSync(BP_COPY)) {
  const bp = readFileSync(BP_SRC, 'utf8').replace("from './locations'", `from '${pathToFileURL(LOCSRC).href}'`);
  writeFileSync(BP_COPY, bp);
}
const { SETTLEMENT_COORDS, CITY_DISTRICT_COORDS } = await import(pathToFileURL(BP_COPY).href);
const CACHE_FILE = path.join(OUT, 'geocache.json');
const cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function photoRaw(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'ecohub-geo-research/1.0' } });
    if (res.ok) return res.json();
    if (res.status === 429) { await sleep(1500 + attempt * 1500); continue; }
    throw new Error(`photon ${res.status}: ${url}`);
  }
  throw new Error('photon rate-limited');
}

async function photonCache(kind, key, url) {
  const ck = `${kind}|${key}`;
  if (cache[ck]) return cache[ck];
  const data = await photoRaw(url);
  cache[ck] = data;
  if (Object.keys(cache).length % 50 === 0) writeFileSync(CACHE_FILE, JSON.stringify(cache));
  await sleep(380);
  return data;
}

const reverse = (lat, lng) => photonCache('rev', `${lat},${lng}`, `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`)
  .then((d) => d.features && d.features[0] ? d.features[0].properties : null);

const forward = (q, lat, lng) => {
  const url = `https://photon.komoot.io/api?q=${encodeURIComponent(q)}&lat=${lat}&lon=${lng}&limit=3`;
  return photonCache('fwd', q, url).then((d) => d.features && d.features[0] ? d.features[0] : null);
};

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/ё/g, 'е').replace(/і/g, 'и').replace(/ў/g, 'у')
  .replace(/ж/g, 'ж')
  .replace(/['’‘`ʼ"]/g, '')
  .replace(/[^а-я0-9]+/g, ' ')
  .replace(/\s+/g, ' ').trim();

const SETTLE_ALIAS = {
  'новогорудок': 'Новогрудок', 'могилев': 'Могилёв', 'могилевская область': 'Могилёвская область',
  'рогачев': 'Рогачёв', 'рогачёв': 'Рогачёв', 'береза': 'Берёза', 'лунинец': 'Лунинцы',
  'буда кошелево': 'Буда-Кошелёво', 'кошелево': 'Буда-Кошелёво', 'марьина горка': 'Марьина Горка',
  'старые дороги': 'Старые Дороги', 'давид городок': 'Давид-Городок', 'большая берестовица': 'Большая Берестовица',
  'белоозерск': 'Белоозёрск', 'минск': 'Минск', 'витебск': 'Витебск', 'гомель': 'Гомель', 'брест': 'Брест',
};

function canonicalSettlement(name) {
  const n = norm(name);
  if (SETTLE_ALIAS[n]) return SETTLE_ALIAS[n];
  for (const oblast of Object.keys(BELARUS)) {
    if (norm(oblast) === n) return oblast;
    for (const s of Object.keys(BELARUS[oblast])) if (norm(s) === n) return s;
  }
  return name;
}

const OBLAST_ALIAS = {
  'г. минск': 'г. Минск', 'город минск': 'г. Минск', 'минск': 'г. Минск',
  'гродненская область': 'Гродненская область', 'брестская область': 'Брестская область',
  'витебская область': 'Витебская область', 'гомельская область': 'Гомельская область',
  'могилевская область': 'Могилёвская область', 'могилёвская область': 'Могилёвская область',
  'минская область': 'Минская область',
};

// синонимы: нормализованный микрорайон из геокодера -> имя района в приложении
const DISTRICT_SYN = (() => {
  const map = {};
  const add = (app, ...variants) => { for (const v of variants) map[v] = app; };
  // Гродно
  add('Центр', 'центр', 'цэнтр');
  add('Победа', 'победа', 'перамога', ' победа');
  add('Ольшанка', 'ольшанка', 'альшанка', ' ольшанка');
  add('Белые Росы', 'белые росы', 'белыя росы');
  add('Девятовка', 'девятовка', 'дэвятовка', 'девятоука', 'дзевятовка');
  add('Зарица', 'зарица', 'зарыца');
  add('Переселка', 'переселка', 'пярэселка', 'переселка', 'пераселка');
  add('Форты', 'форты');
  add('Антоново', 'антоново', 'антонова');
  add('Грандичи', 'грандичи', 'грандзічы', 'грандичи');
  add('Лососно', 'лососно', 'ласосна', 'лососна');
  add('Барановичи', 'барановичи', 'баранавічы');
  add('Фолюш', 'фолюш');
  add('Понемунь', 'понемунь', 'панямунь');
  add('Южный', 'южный', 'паудненый', 'павудневы', 'паўднёвы', 'юг');
  add('Вишневец', 'вишневец', 'вишнявец');
  add('Колбасино', 'колбасино', 'калбасіна', 'колбасино');
  // Минск
  add('Уручье', 'уручье', 'уручча', 'уручче');
  add('Зелёный Луг', 'зеленый луг', 'зялены луг', 'зелёный луг');
  add('Восток', 'восток', 'усход');
  add('Серебрянка', 'серебрянка', 'серабранка');
  add('Чижовка', 'чижовка', 'чыховка', 'чыжоука');
  add('Шабаны', 'шабаны');
  add('Ангарская', 'ангарская');
  add('Лошица', 'лошица', 'лошыца', 'лошица');
  add('Малиновка', 'малиновка', 'малинаука', 'малинавка', 'малиновка');
  add('Юго-Запад', 'юго запад', 'паудневы захад', 'паўднёвы захад');
  add('Каменная Горка', 'каменная горка');
  add('Сухарево', 'сухарево', 'сухарэва');
  add('Кунцевщина', 'кунцевщина', 'кунцаушчина', 'кунцаўшчына');
  add('Масюковщина', 'масюковщина', 'масюкоущина', 'масюкоўшчына');
  add('Курасовщина', 'курасовщина', 'курасоущина', 'курасоўшчына');
  add('Грушевка', 'грушевка', 'грушевка', 'грушоука', 'грушаўка');
  add('Веснянка', 'веснянка', 'вяснянка');
  add('Цна', 'цна');
  add('Степянка', 'степянка', 'сцяпянка', 'стэпянка');
  add('Михалово', 'михалово', 'михалова', 'міхалова');
  add('Брилевичи', 'брилевичи', 'брылевичи', 'брылевічы');
  add('Петровщина', 'петровщина', 'пятровщина', 'пятроўшчына', 'петроушчина');
  add('Харьковская', 'харьковская', 'харкауская', 'харкаўская');
  add('Запад', 'запад', 'захад');
  add('Новинки', 'новинки', 'навинки', 'навінкі');
  add('Сокол', 'сокол', 'сокал');
  add('Дражня', 'дражня');
  add('Медвежино', 'медвежино', 'мядвежина', 'мядзвежына');
  add('Слепянка', 'слепянка', 'сляпянка');
  // Брест
  add('Ковалёво', 'ковалево', 'кавалева', 'кавалёва');
  add('Гречихи', 'гречихи', 'грэчихи', 'грэчахи');
  add('Вулька', 'вулька');
  add('Речица', 'речица', 'рэчьица', 'рэчыца');
  add('Киевка', 'киевка');
  // Витебск
  add('Битевля', 'битевля', 'бителево', 'бицелево', 'біцялёва', 'битела');
  add('Медведево', 'медведево', 'мядзведзева');
  add('Черняховского', 'черняховского', 'чарняхоускага');
  add('Зелёный Бор', 'зеленый бор', 'зялёны бор');
  add('Титова', 'титова', 'цитова', 'цітова');
  // Гомель
  add('Волотова', 'волотова', 'волатава');
  add('Мельников Луг', 'мельников луг', 'мельникоу луг', 'мельнікаў луг');
  add('Фестивальный', 'фестивальный', 'фэстывальны');
  add('Западный', 'западный', 'заходні');
  add('Новобелица', 'новобелица', 'новабелица', 'новабеліца');
  add('Медгородок', 'медгородок', 'медгородок', 'мядгорадок');
  add('Хутор', 'хутор', 'хутар');
  // Могилёв
  add('Казимировка', 'казимировка', 'казіміраўка');
  add('Юбилейный', 'юбилейный', 'юбілейны');
  add('Гребенево', 'гребенево', 'гребенево', 'грэбенёва');
  add('Спутник', 'спутник', 'спутнік');
  add('Любуж', 'любуж');
  add('Мир-2', 'мир 2', 'світ', 'свет');
  // Барановичи
  add('Боровки', 'боровки', 'бароуки', 'бараўкі');
  add('Текстильщик', 'текстильщик', 'тэкстыльшчык');
  add('Брестский', 'брестский', 'брэсцкі');
  // Пинск
  add('Радужный', 'радужный', 'радужны');
  add('Северный', 'северный', 'паудночы', 'паўночны');
  add('Западный', 'западный', 'заходні');
  // Лида
  add('Сельмаш', 'сельмаш');
  add('Молодёжный', 'молодежный', 'моладзежны', 'маладзёжны');
  // Бобруйск
  add('Киселевичи', 'киселевичи', 'киселевичи');
  add('Слободка', 'слободка');
  // Орша
  add('Заднепровье', 'заднепровье', 'задняпроуе', 'задняпроўе');
  // Полоцк
  add('Задвинье', 'задвинье', 'задзвінне', 'задвинье');
  // Новополоцк
  add('Боровуха', 'боровуха', 'баравуха');
  //Солигорск
  add('Первый', 'первый', 'першы');
  add('Второй', 'второй', 'другi', 'другі');
  add('Третий', 'третий', 'трэці');
  add('Четвёртый', 'четвертый', 'чацвёрты');
  // Борисов
  add('Фатимский', 'фатимский', 'фатымскi');
  add('Печи', 'печи');
  add('Новосёлки', 'новоселки', 'навасёлкі');
  return map;
})();

function matchDistrict(settlement, suburb) {
  const n = norm(suburb);
  const fromSyn = DISTRICT_SYN[n];
  if (fromSyn) return fromSyn;
  const list = BELARUS[objOf(settlement)]?.[settlement] || [];
  const nn = n.replace(/\s+/g, '');
  for (const d of list) {
    if (nn.includes(norm(d).replace(/\s+/g, ''))) return d;
  }
  return null;
}

function objOf(settlement) {
  for (const obl of Object.keys(BELARUS)) if (BELARUS[obl][settlement]) return obl;
  return null;
}

function nearestCentroid(lat, lng, settlement) {
  const map = CITY_DISTRICT_COORDS[settlement] || CENTROID_CATALOG[settlement];
  if (!map) return null;
  let best = null, bd = Infinity;
  for (const [name, [clat, clng]] of Object.entries(map)) {
    if (name === 'Весь населённый пункт') continue;
    const d = (lat - clat) ** 2 + (lng - clng) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

const smallTownDistrict = (lat, lng, settlement) => {
  const c = SETTLEMENT_COORDS[settlement];
  if (!c) return 'Центр';
  const km = (Math.abs(lat - c[0]) * 111) ** 2 + (Math.abs(lng - c[1]) * 111 * Math.cos(c[0] * Math.PI / 180)) ** 2;
  if (Math.sqrt(km) <= 1.25) return 'Центр';
  return 'Весь населённый пункт';
};

const BIG = new Set();
for (const obl of Object.keys(BELARUS)) for (const [s, ds] of Object.entries(BELARUS[obl])) {
  if (ds.length > 2) BIG.add(s);
}

// каталог: город -> {район: [lat,lng]} через прямой геокодинг "район, город"
const CENTROID_CATALOG = {};
for (const [obl, settl] of Object.entries(BELARUS)) {
  for (const [city, ds] of Object.entries(settl)) {
    if (!BIG.has(city) || CITY_DISTRICT_COORDS[city]) continue;
    const center = SETTLEMENT_COORDS[city];
    if (!center) continue;
    for (const d of ds) {
      if (['Центр', 'Весь населённый пункт'].includes(d)) continue;
      const f = await forward(`${d}, ${city}`, center[0], center[1]);
      if (!f) continue;
      const pr = f.properties, g = f.geometry.coordinates;
      const distKm = Math.hypot((g[1] - center[0]) * 111, (g[0] - center[1]) * 111 * Math.cos(center[0] * Math.PI / 180));
      if (distKm < 25) {
        CENTROID_CATALOG[city] = CENTROID_CATALOG[city] || {};
        CENTROID_CATALOG[city][d] = [g[1], g[0]];
      }
    }
    if (CENTROID_CATALOG[city]) writeFileSync(CACHE_FILE, JSON.stringify(cache));
  }
}
console.log('центроиды: ' + Object.entries(CENTROID_CATALOG).map(([c, m]) => `${c}:${Object.keys(m).length}`).join(', '));

function canonicalOblast(name) {
  const n = norm(name);
  return OBLAST_ALIAS[n] || name;
}

const APPLY = process.argv.includes('--apply');

const data = [];
const addRow = (src, p) => data.push({ src, key: String(p.source_key), address: p.address, name: p.name,
  oblast: canonicalOblast(p.oblast), settlement: canonicalSettlement(p.settlement),
  rawSettlement: p.settlement, district: p.district || '', lat: p.lat, lng: p.lng,
  districtList: (BELARUS[canonicalOblast(p.oblast)] || {})[canonicalSettlement(p.settlement)] || [] });

for (const p of JSON.parse(readFileSync(new URL('../src/data/target99-points.json', import.meta.url), 'utf8'))) addRow('target99', p);
for (const p of JSON.parse(readFileSync(new URL('../src/data/charity-points.json', import.meta.url), 'utf8'))) addRow('charity', p);
for (const p of REGION_POINTS) addRow('region', p);
for (const p of POINTS) if (!String(p.source_key).startsWith('region:')) addRow('grodno', p);

// геокодинг
let nDone = 0;
for (const r of data) {
  const inBig = BIG.has(r.settlement);
  const needs = inBig || r.src === 'grodno';
  if (!needs) continue;
  if (r.district && BIG.has(r.settlement) && r.districtList.includes(r.district)) continue;
  if (r.src === 'region') {
    const f = await forward(`${r.settlement}, ${r.address}`, r.lat, r.lng);
    if (f) {
      const pr = f.properties, g = f.geometry.coordinates;
      r.geo = { suburb: pr.district, city: pr.city, coords: [g[1], g[0]],
        assignedDistrict: pr.district && inBig ? matchDistrict(r.settlement, pr.district) : null,
        assignedLat: +(g[1].toFixed(5)), assignedLng: +(g[0].toFixed(5)) };
    }
  } else {
    const pr = await reverse(r.lat, r.lng);
    if (pr) r.geo = { suburb: pr.district, city: pr.city,
      assignedDistrict: r.src === 'grodno' || inBig ? matchDistrict(r.settlement, pr.district) : null };
  }
  nDone++;
  if (nDone % 100 === 0) console.log(`... geocoded ${nDone}`);
}
for (const r of data) {
  if (r.src === 'region' || r.lat == null) continue;
  const sett = canonicalSettlement(r.settlement);
  const centre = SETTLEMENT_COORDS[sett];
  if (!centre) continue;
  const dkm = Math.hypot((r.lat - centre[0]) * 111, (r.lng - centre[1]) * 111 * Math.cos(centre[0] * Math.PI / 180));
  if (dkm <= 10) continue;
  const f = await photonForward(r.address, r.lat, r.lng);
  if (!f || !f.city) continue;
  const candName = canonicalSettlement(String(f.city).trim().replace(/[\)\]]+.*/, '').trim());
  if (!candName || candName === sett) continue;
  const oblique = oblFromAddress(r.address);
  const obl = oblique ? canonicalOblast(oblique) : r.oblast;
  if (BELARUS[obl] && BELARUS[obl][candName]) r.fix = f;
}
writeFileSync(CACHE_FILE, JSON.stringify(cache));

function cardinalFallback(lat, lngRaw, settlement, list) {
  const lng = +lngRaw;
  if (settlement === 'Орша' && lng > 30.437) return 'Заднепровье';
  if (settlement === 'Полоцк' && lng < 28.705) return 'Задвинье';
  if (settlement === 'Новополоцк' && lng < 28.575) return 'Боровуха';
  const c = SETTLEMENT_COORDS[settlement];
  if (!c) return 'Центр';
  const dN = (lat - c[0]) * 111;
  const dE = (lng - c[1]) * 111 * Math.cos(c[0] * Math.PI / 180);
  if (Math.hypot(dN, dE) <= 1.4) return 'Центр';
  const find = (re) => list.find((d) => re.test(d));
  if (dN > 0.9) { const m = find(/север/i); if (m) return m; }
  if (dN < -0.9) { const m = find(/юг/i); if (m) return m; }
  if (dE > 1.1) { const m = find(/восток|восточн/i); if (m) return m; }
  if (dE < -1.1) { const m = find(/запад|западн/i); if (m) return m; }
  return 'Центр';
}

function usableCentroids(settlement, list) {
  if (CITY_DISTRICT_COORDS[settlement]) return true;
  const cat = CENTROID_CATALOG[settlement];
  if (!cat) return false;
  const n = Object.keys(cat).length;
  return n >= 3 && n * 2 >= list.length;
}

const GRODNO_OVERRIDE = [
  { match: ['ткацкая'], district: 'Лососно' },
  { match: ['скидельское шоссе'], district: 'Понемунь' },
  { match: ['аульская'], district: 'Понемунь' },
  { match: ['подольная'], district: 'Центр' },
  { match: ['ложице'], district: 'Форты' },
  { match: ['озерское шоссе'], district: 'Победа' },
  { match: ['озёрское шоссе'], district: 'Победа' },
];

function grodnoOverride(address) {
  const a = String(address || '').toLowerCase();
  for (const row of GRODNO_OVERRIDE) if (row.match.some((m) => a.includes(m))) return row.district;
  return null;
}

const out = data.map((r) => {
  const inBig = BIG.has(r.settlement);
  const geoDistrict = r.geo?.assignedDistrict;
  let district = null;
  let flags = [];
  if (inBig) {
    const grodnoCur = r.settlement === 'Гродно' ? grodnoOverride(r.address) : null;
    if (grodnoCur) district = grodnoCur;
    else if (r.settlement === 'Гродно' && CITY_DISTRICT_COORDS.Гродно) {
      district = nearestCentroid(r.lat, r.lng, r.settlement);
      flags.push('GRODNO_CENTROID');
    }
    else if (geoDistrict && r.districtList.includes(geoDistrict)) district = geoDistrict;
    else if (r.districtList.includes(r.district) && r.district) district = r.district;
    else {
      const hasCent = usableCentroids(r.settlement, r.districtList);
      const nc = hasCent ? nearestCentroid(r.lat, r.lng, r.settlement) : null;
      const cf = !nc ? cardinalFallback(r.lat, r.lng, r.settlement, r.districtList) : null;
      district = nc || cf || 'Центр';
      flags.push(nc ? 'CENTROID' : cf && cf !== 'Центр' ? 'CARDINAL' : 'CENTER_FALLBACK');
    }
  } else {
    const dd = smallTownDistrict(r.lat, r.lng, r.settlement);
    district = r.districtList.includes(dd) ? dd : (r.districtList.includes(r.district) && r.district ? r.district : 'Центр');
  }
  const sett = canonicalSettlement(r.settlement);
  if (sett !== r.rawSettlement) flags.push('SETTLE');
  const centerCo = SETTLEMENT_COORDS[sett];
  if (centerCo && r.lat != null) {
    const dkm = Math.hypot((r.lat - centerCo[0]) * 111, (r.lng - centerCo[1]) * 111 * Math.cos(centerCo[0] * Math.PI / 180));
    if (dkm > 10) flags.push(`FAR_${Math.round(dkm)}`);
  }
  return { src: r.src, key: r.key, address: r.address, oblast: r.oblast, settlement: sett,
    oldSettlement: r.rawSettlement, district: district || '', oldDistrict: r.district,
    lat: r.geo?.assignedLat ?? r.lat, lng: r.geo?.assignedLng ?? r.lng,
    suburb: r.geo?.suburb || '', flags: flags.join(',') };
});

async function photonForward(q, lat, lng) {
  const key = 'fwd:' + String(q);
  if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
  await sleep(380);
  const url = `https://photon.komoot.io/api?q=${encodeURIComponent(String(q))}&lat=${lat || ''}&lon=${lng || ''}&limit=5`;
  try {
    const res = await photoRaw(url);
    const feats = res.features || [];
    const isBy = (p) => /Гродненская|Минская|Брестская|Гомельская|Витебская|Могил/.test([p.state, p.county, p.city].join(' '));
    const ok = (p) => ['village', 'town', 'city', 'hamlet', 'municipality'].includes(p.osm_value);
    const pool = feats.filter((f) => isBy(f.properties));
    const pick = (pool.length ? pool : feats).find((f) => ok(f.properties));
    const top = pick || (pool.length ? pool : feats)[0];
    if (!top || !isBy(top.properties)) { cache[key] = null; return null; }
    const p = top.properties;
    const out = { lat: top.geometry.coordinates[1], lng: top.geometry.coordinates[0], city: p.city || p.name || null };
    cache[key] = out;
    return out;
  } catch { cache[key] = null; return null; }
}

function oblFromAddress(a) {
  const re = /(брестск\w*\s+област\w*|витебск\w*\s+област\w*|гомельск\w*\s+област\w*|гродненск\w*\s+област\w*|минск\w*\s+област\w*|могилёвск\w*\s+област\w*|могилевск\w*\s+област\w*|.[\wё]*ск[ая]?\s+район|ск[ая]?\s+р-н)/i;
  const m = String(a || '').match(re);
  if (!m) return null;
  const t = m[1].toLowerCase();
  if (/брест/.test(t)) return 'Брестская область';
  if (/витебск/.test(t)) return 'Витебская область';
  if (/гомель/.test(t)) return 'Гомельская область';
  if (/гроднен/.test(t)) return 'Гродненская область';
  if (/могил|могилёв/.test(t)) return 'Могилёвская область';
  return 'Минская область';
}

const out2 = out.map((r) => {
  if (!r.fix || !r.fix.city) return r;
  const candName = canonicalSettlement(String(r.fix.city).trim().replace(/[\)\]].*/, '').trim());
  if (!candName) return r;
  const oblique = oblFromAddress(r.address);
  const obl = oblique ? canonicalOblast(oblique) : r.oblast;
  if (candName === r.settlement && +r.lat === +r.fix.lat && +r.lng === +r.fix.lng) return r;
  const list = (BELARUS[obl] && BELARUS[obl][candName]);
  if (!list) return { ...r, flags: r.flags + ',REVIEW_SETTLE' };
  return { ...r, oblast: obl, settlement: candName,
    lat: r.fix.lat, lng: r.fix.lng,
    district: list.includes('Центр') ? 'Центр' : list[list.length - 1],
    flags: r.flags + ',FIXED_SETTLE' };
});
writeFileSync(path.join(OUT, 'assignments.json'), JSON.stringify(out2, null, 1));
const review = out2.filter((r) => r.flags || !r.district);
writeFileSync(path.join(OUT, 'review.json'), JSON.stringify(review, null, 1));

if (APPLY) apply(out2);

const stat = (pred) => data.reduce((a, r, i) => a + (pred(r, i) ? 1 : 0), 0);
console.log(`\nВсего точек: ${data.length}`);
console.log(`Геокодировано: ${stat((r) => !!r.geo)}`);
console.log(`Пустых district осталось: ${out2.filter((r) => !r.district).length}`);
console.log(`district изменится: ${stat((r, i) => out2[i].district !== r.district)}`);
console.log(`settlement изменится: ${stat((r, i) => out2[i].settlement !== r.settlement)}`);
console.log(`REVIEW: ${review.length}`);
const missing = {};
for (const r of data) if (!BELARUS[r.oblast] || !BELARUS[r.oblast][r.settlement]) {
  const k = `${r.oblast}|${r.settlement}`; missing[k] = (missing[k] || 0) + 1;
}
if (Object.keys(missing).length) console.log('\nНаселённые пункты НЕ в списках приложения:', JSON.stringify(missing, null, 0));
console.log(`Артефакты: ${OUT}`);

function apply(outRows) {
  const byKey = new Map(outRows.map((r) => [r.key, r]));
  const same = (o, v) => String(o ?? '') === String(v ?? '');
  const touch = (p, o) => {
    let changed = 0;
    for (const [f, key] of [['district', 'district'], ['settlement', 'settlement'], ['oblast', 'oblast']]) {
      if (!same(p[f], o[key])) { p[f] = o[key]; changed++; }
    }
    if (o.flags && o.flags.includes('FIXED_SETTLE') && o.lat && (String(o.src) === 'target99' || String(o.src) === 'charity')) {
      if (+p.lat !== +o.lat) { p.lat = o.lat; p.lng = o.lng; changed++; }
    }
    return changed;
  };
  const D = (f) => path.resolve(import.meta.dirname, '..', f);
  const backup = (f) => writeFileSync(f + '.bak', readFileSync(f, 'utf8'));

  let n1 = 0, n2 = 0, n3 = 0;
  const f99 = D('src/data/target99-points.json');
  backup(f99);
  const t99 = JSON.parse(readFileSync(f99, 'utf8'));
  for (const p of t99) { const o = byKey.get(String(p.source_key)); if (o) n1 += touch(p, o); }
  writeFileSync(f99, JSON.stringify(t99, null, 2) + '\n');

  const fch = D('src/data/charity-points.json');
  backup(fch);
  const ch = JSON.parse(readFileSync(fch, 'utf8'));
  for (const p of ch) { const o = byKey.get(String(p.source_key)); if (o) n2 += touch(p, o); }
  writeFileSync(fch, JSON.stringify(ch, null, 2) + '\n');

  const frp = D('src/points-regions.js');
  backup(frp);
  const head = readFileSync(frp, 'utf8').split('export const REGION_POINTS = [')[0];
  for (const p of REGION_POINTS) {
    const o = byKey.get(String(p.source_key));
    if (o && !same(p.district, o.district)) { p.district = o.district; n3++; }
  }
  writeFileSync(frp, `${head}export const REGION_POINTS = ${JSON.stringify(REGION_POINTS, null, 2)};\n`);

  const fd = D('src/points-data.js');
  backup(fd);
  const dsrc = readFileSync(fd, 'utf8').replace(/export const DATA_VERSION = \d+;/, 'export const DATA_VERSION = 15;');
  if (dsrc !== readFileSync(fd, 'utf8')) writeFileSync(fd, dsrc);

  console.log(`✓ Применено: target99=${n1} изменений, charity=${n2}, regions(район)=${n3} (бекапы: *.bak)`);
}