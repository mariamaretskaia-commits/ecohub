import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SRC = 'C:/Users/Admin/AppData/Local/Temp/opencode/charity-src';
const T99 = JSON.parse(readFileSync('C:/Users/Admin/eco-grodno/server/src/data/target99-points.json', 'utf8'));
// Ключ геокодера берём только из окружения — в код его больше не кладём.
const GEO_KEY = process.env.YANDEX_GEO_KEY || '';
const TODAY = process.env.CHARITY_TODAY || '2026-09-10';

if (!GEO_KEY) {
  console.error('YANDEX_GEO_KEY не задан — геокодирование адресов недоступно.');
  process.exit(1);
}

// settlement -> { oblast, lat, lng } из target99
const CITIES = new Map();
for (const row of T99) {
  const s = String(row.settlement || '').trim();
  if (!s || CITIES.has(s)) continue;
  CITIES.set(s, { oblast: row.oblast, lat: row.lat, lng: row.lng });
}

const OBLAST_FALLBACK = {
  Минск: 'г. Минск', Гродно: 'Гродненская область', Брест: 'Брестская область',
  Витебск: 'Витебская область', Гомель: 'Гомельская область', Могилев: 'Могилёвская область',
  Могилёв: 'Могилёвская область', Мозырь: 'Гомельская область', Пинск: 'Брестская область',
  Иваново: 'Брестская область', Кобрин: 'Брестская область', Полоцк: 'Витебская область',
  Клецк: 'Минская область', Заславль: 'Минская область', Верхнедвинск: 'Витебская область',
};

function readHtml(file) {
  try { return readFileSync(`${SRC}/${file}`, 'utf8'); } catch { return null; }
}

function parseJsonCompanyList(html) {
  if (!html) return null;
  const s = html.indexOf('var json_company_list');
  if (s < 0) return null;
  const start = html.indexOf('{', html.indexOf('=', s));
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return JSON.parse(html.slice(start, i + 1)); }
  }
  return null;
}

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function fmtPhone(raw) {
  // "+375 (17) 293 19 37" -> "+375 (17) 293-19-37"; "Тел. (+375-17) 3980540" -> "+375 (17) 398-05-40"
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 11 && digits.startsWith('375')) {
    const d = digits.slice(3);
    if (d.length === 9) return `+375 (${d.slice(0, 2)}) ${d.slice(2, 5)}-${d.slice(5, 7)}-${d.slice(7, 9)}`;
    if (d.length === 8) return `+375 (${d.slice(0, 2)}) ${d.slice(2, 5)}-${d.slice(5, 8)}`;
  }
  return clean(raw);
}

// ---------- IBIZ ----------
function parseIbiz() {
  const orgs = new Map();
  for (const file of ['ibiz-main.html', 'ibiz-minsk.html', 'ibiz-mozyr.html', 'ibiz-grodno.html', 'ibiz-vitebsk.html']) {
    const j = parseJsonCompanyList(readHtml(file));
    if (!j) continue;
    for (const f of j.features || []) {
      const id = String(f.id);
      if (orgs.has(id)) continue;
      const name = clean(((f.properties?.balloonContentHeader || '').replace(/<[^>]+>/g, '')).replace(/&#39;/g, "'"));
      const phonesRaw = (f.phones || '').match(/tel:(\+?[0-9]+)/g) || [];
      const phones = [...new Set(phonesRaw.map((t) => t.replace('tel:', '')))].map((d) => fmtPhone(d)).filter(Boolean);
      const hoursM = (f.properties?.balloonContentBody || '').match(/fa fa-clock-o[\s\S]*?<span>([\s\S]*?)<\/span>/);
      const org = {
        name,
        desc: clean(f.rek),
        address: clean(f.address),
        coords: f.geometry?.coordinates || null,
        phone: phones[0] || '',
        phones,
        url: String(f.client_url || '').replace(/^\/\//, 'http://'),
        hours: clean(hoursM ? hoursM[1] : ''),
        source_key: `charity:ibiz:${id}`,
        source: 'https://ibiz.by/gosudarstvo-i-obshchestvo/blagotvoritelnye-organizacii-fondy',
      };
      orgs.set(id, org);
    }
  }
  return [...orgs.values()];
}

// ---------- BELARUSINFO ----------
const BEL_SKIP = [
  'Клуб любителей путешествий', 'Белорусская конфедерация промышленников', 'Бизнес союз предпринимателей',
  'Красный Октябрь ОАО', 'Комитет предпринимательства и инвестиций', 'ЭкоСтроитель',
  'Радзiма',
];

function parseBelarusinfo() {
  const orgs = new Map();
  for (let p = 0; p < 4; p++) {
    const html = readHtml(`bel-${p}.html`);
    if (!html) continue;
    const blocks = html.split('<div class="zvers_c ');
    for (const b of blocks.slice(1)) {
      const mId = b.match(/href="\/ru\/poisk\/(\d+)\.html"/);
      if (!mId) continue;
      const id = mId[1];
      if (orgs.has(id)) continue;
      const nameM = b.match(/<div class="s_c_title"[\s\S]*?>([\s\S]*?)<\/a>/);
      const name = clean((nameM ? nameM[1] : '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ');
      if (BEL_SKIP.some((s) => name.toLowerCase().includes(s.toLowerCase()))) continue;
      const descM = b.match(/<div class="reklamstrokazver">([\s\S]*?)<\/div>/);
      const addrM = b.match(/streetAddress">([\s\S]*?)<\/div>/);
      const telM = b.match(/<span class="ch_phone" itemprop="telephone">([\s\S]*?)<\/span>/);
      const siteM = b.match(/<div class="saitzzz">[\s\S]*?<a itemprop="url" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
      const addr = clean(addrM ? addrM[1] : '');
      const cityFromAddr = (addr.match(/^\d+\s*([А-ЯЁа-яё][А-ЯЁа-яё\-\s]+?),\s/) || [])[1];
      orgs.set(id, {
        name,
        desc: clean(descM ? descM[1] : ''),
        addr,
        phone: fmtPhone(telM ? telM[1] : ''),
        site: (siteM ? siteM[1] : '').trim(),
        cityGuess: (bigCity(addr) || cityFromAddr || '').trim(),
        source_key: `charity:belarusinfo:${id}`,
        source: `https://www.belarusinfo.by/ru/poisk/${id}.html`,
      });
    }
  }
  return [...orgs.values()];
}

function bigCity(addr) {
  const m = addr.match(/^\d+\s+(Минск|Гродно|Брест|Витебск|Гомель|Могилев|Могилёв|Мозырь|Пинск|Иваново)/);
  return m ? m[1] : '';
}

// address для геокодинга: убрать почтовый индекс и название города
function streetOnly(addr) {
  let s = clean(addr).replace(/^\d{6}\s*/, '');
  s = s.replace(/^\s*[А-ЯЁа-яё][А-ЯЁа-яё\-]*\s*,?\s*/, '');
  return s;
}

async function geocode(query) {
  try {
    const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${GEO_KEY}&format=json&geocode=${encodeURIComponent(query)}&results=1`;
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    const f = j?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    if (!f) return null;
    const [lon, lat] = f.Point.pos.split(' ').map(Number);
    if (lat < 51 || lat > 57 || lon < 22 || lon > 35) return null; // за пределами Беларуси
    return { lat, lng: lon };
  } catch {
    return null;
  }
}

// ---------- merge ----------
export async function buildCharityPoints() {
  const ibiz = parseIbiz();
  const bel = parseBelarusinfo();

  const out = [];
  const usedAddr = new Set();
  const usedNames = new Set();

  function add(org, geo, settlement, oblast, address, shortAddress, phone, hours, website, description) {
    const row = {
      name: org.name,
      organization: org.name,
      type: 'clothing',
      district: '',
      lat: geo?.lat ?? CITIES.get(settlement)?.lat ?? null,
      lng: geo?.lng ?? CITIES.get(settlement)?.lng ?? null,
      address,
      phone,
      website,
      hours,
      prices: '',
      logistics: 'Вещи и помощь принимают по указанным адресам и контактам.',
      description,
      short_address: shortAddress || address,
      source_key: org.source_key,
      accepts: 'clothing',
      last_synced: TODAY,
      oblast,
      settlement,
      access_mode: 'desk',
      source: org.source,
    };
    out.push(row);
  }

  // IBIZ (уже с координатами)
  for (const org of ibiz) {
    const [settlement, ...streetParts] = org.address.split(',').map((x) => x.trim());
    const street = streetParts.join(', ');
    const s = settlement.replace(/^(г\.|город)\s*/i, '').trim();
    const oblast = OBLAST_FALLBACK[s] || CITIES.get(s)?.oblast || '';
    const geo = org.coords ? { lat: org.coords[0], lng: org.coords[1] } : CITIES.get(s);
    add(
      org, geo, s, oblast,
      org.address,
      street,
      org.phone || org.phones[0] || '',
      org.hours || 'Пн–Пт 09:00–17:00 (уточняйте по телефону)',
      org.url,
      org.desc,
    );
    usedAddr.add(norm(s, street));
    usedNames.add(normName(org.name));
  }

  // BELARUSINFO (геокодируем)
  const geoCache = new Map();
  for (const org of bel) {
    let settlement = org.cityGuess;
    let street = streetOnly(org.addr);
    if (!settlement) {
      const t = String(org.name);
      const cm = t.match(/(Минская|Брестская|Витебская|Гомельская|Гродненская|Могилевская|Могилёвская)\s+[а-яёё]+/i) || t.match(/(Верхнедвинск)\w*/i);
      if (cm && cm[1] === 'Верхнедвинск') settlement = cm[1];
    }
    if (!settlement) {
      // fallback: имя организации содержит город
      for (const k of Object.keys(OBLAST_FALLBACK)) {
        if (org.name.includes(k)) { settlement = k; break; }
      }
    }
    settlement = (settlement || 'Минск').replace(/^г\.\s*/i, '').trim();
    const oblast = OBLAST_FALLBACK[settlement] || CITIES.get(settlement)?.oblast || '';
    const key = norm(settlement, street);
    if (usedAddr.has(key)) continue; // уже есть из ibiz (напр. ЮниХелп)
    if (usedNames.has(normName(org.name))) continue; // та же организация из ibiz (МИР БЕЗ ГРАНИЦ)
    let geo;
    if (street) {
      const q = `${settlement}, ${street}`;
      if (!geoCache.has(q)) { geoCache.set(q, await geocode(q)); await sleep(600); }
      geo = geoCache.get(q);
    }
    if (!geo) geo = CITIES.get(settlement);
    add(
      org, geo, settlement, oblast,
      street ? `${settlement}, ${street}` : settlement,
      street,
      org.phone,
      'Пн–Пт 09:00–17:00 (по телефонам приёмной)',
      org.site ? (org.site.startsWith('http') ? org.site : `http://${org.site}`) : '',
      org.desc,
    );
    usedAddr.add(key);
  }

  return { rows: out, ibiz: ibiz.length, bel: bel.length, cities: CITIES.size };
}

function norm(settlement, street) {
  return `${String(settlement || '').toLowerCase().replace(/ё/g, 'е')}|${String(street || '').toLowerCase().replace(/ё/g, 'е').replace(/[^а-яёё0-9]+/g, '').replace(/^улица/, '')}`;
}

function normName(name) {
  return String(name || '').toLowerCase().replace(/ё/g, 'е').replace(/[^а-яёё0-9]+/g, '');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

if (process.argv.slice(2).includes('--build')) {
  const { rows, ibiz, bel, cities } = await buildCharityPoints();
  const dir = 'C:/Users/Admin/eco-grodno/server/src/data';
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/charity-points.json`, JSON.stringify(rows, null, 2));
  let noGeo = 0;
  for (const r of rows) if (!r.lat || !r.lng) noGeo++;
  console.log(`ibiz orgs: ${ibiz}, belarusinfo orgs: ${bel}, итого строк: ${rows.length}, без координат: ${noGeo}`);
  const byOblast = {};
  for (const r of rows) byOblast[r.oblast] = (byOblast[r.oblast] || 0) + 1;
  console.log('по областям:', JSON.stringify(byOblast));
  const uniq = new Set(rows.map((r) => r.name));
  console.log('уникальных организаций:', uniq.size);
}