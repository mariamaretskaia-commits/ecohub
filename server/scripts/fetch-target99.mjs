import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');
const MAP_PAGE = 'https://target99.by/resources/map';
const DATA_API = 'https://target99.by/ajax/map/resources/?resource=0';

const RESOURCE_LABEL = {
  9: 'макулатура',
  10: 'автошины',
  11: 'лампы и ртутьсодержащие',
  12: 'стекло',
  13: 'бытовая техника',
  14: 'отработанные автомасла',
  15: 'ПЭТ-пластик',
  16: 'элементы питания и батарейки',
  5363: 'металлолом',
  5384: 'древесина, мебель',
  5397: 'органические отходы',
  5421: 'иные виды отходов',
};

const RESOURCE_TYPE = {
  9: ['paper'],
  10: ['other'],
  11: ['hazardous'],
  12: ['glass'],
  13: ['electronics'],
  14: ['hazardous'],
  15: ['plastic'],
  16: ['hazardous'],
  5363: ['metal'],
  5384: ['other'],
  5397: ['other'],
  5421: ['other'],
};

const TYPE_PRIORITY = [16, 11, 14, 9, 15, 12, 13, 5363, 10, 5384, 5397, 5421];

function decode(html) {
  return String(html || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, (m) => m);
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractCityMap(html) {
  const cityMap = new Map();
  const selects = String(html).match(/<select[^>]*>([\s\S]*?)<\/select>/gi) || [];
  for (const select of selects) {
    if (!/location-check/.test(select) && !/Брестская область/.test(select)) continue;
    const options = select.match(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi) || [];
    let region = '';
    for (const opt of options) {
      const valueMatch = opt.match(/value="([^"]*)"/i);
      const textMatch = opt.match(/<option[^>]*>([\s\S]*?)<\/option>/i);
      const value = valueMatch ? valueMatch[1].trim() : '';
      const text = decode(stripTags(textMatch ? textMatch[1] : ''));
      if (value.includes(',')) { region = text; continue; }
      if (value && region && text) cityMap.set(value, { name: text, oblast: region });
    }
  }
  return cityMap;
}

const TYPE_NAME = {
  'пункт приема вторичных ресурсов': 'Пункт приёма вторсырья',
  'другое место приема': 'Другое место приёма',
  'контейнер в магазине': 'Контейнер в магазине',
  'площадка для сбора': 'Площадка для сбора',
};

function cleanName(text) {
  return String(text || '')
    .replace(/^[\s\d.;:\-—()"\u00A0]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBody(bodyHtml) {
  const raw = String(bodyHtml || '');
  const out = { accepts: [], phone: '', hours: '', organization: '' };

  const ul = raw.match(/<ul[^>]*>([\s\S]*?)<\/ul>/i);
  if (ul) {
    const lis = ul[1].match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    for (const li of lis) {
      const text = decode(stripTags(li));
      if (text) out.accepts.push(text);
    }
  }

  const ps = raw.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  for (const p of ps) {
    const labelMatch = p.match(/<span class="fw-bold">([^<]+)<\/span>/i);
    if (!labelMatch) continue;
    const label = decode(stripTags(labelMatch[1])).toLowerCase().replace(/\s+/g, ' ').trim();
    const value = decode(stripTags(p.replace(/<span[^>]*>[\s\S]*?<\/span>/i, ''))).trim();
    if (!value) continue;
    if (/Телефон|Тел\./i.test(label)) out.phone = value;
    else if (/Режим работы|График/i.test(label)) out.hours = value;
    else if (/Собственник|Заготовительн/i.test(label)) out.organization = value;
  }

  return out;
}

function pickType(resources) {
  for (const r of TYPE_PRIORITY) if (resources.includes(r)) return RESOURCE_TYPE[r][0];
  return 'other';
}

async function main() {
  const [pageRes, dataRes] = await Promise.all([
    fetch(MAP_PAGE, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }),
    fetch(DATA_API, { headers: { 'user-agent': 'Mozilla/5.0' } }),
  ]);
  if (!pageRes.ok || !dataRes.ok) throw new Error(`fetch failed: page=${pageRes.status} data=${dataRes.status}`);
  const page = await pageRes.text();
  const data = await dataRes.json();
  const features = Array.isArray(data?.features) ? data.features : [];

  const cityMap = extractCityMap(page);
  console.log(`cities parsed: ${cityMap.size}`);

  const rows = [];
  const unresolved = new Set();
  const typesCount = new Map();
  const accessByName = new Map();
  const oblastCount = new Map();

  for (const f of features) {
    const cityId = String(f.options?.city ?? '');
    const city = cityMap.get(cityId);
    if (!city) unresolved.add(cityId);
    const resources = Array.isArray(f.options?.resources) ? f.options.resources : [];
    const body = parseBody(f.properties?.balloonContentBody);
    const header = cleanName(f.properties?.balloonContentHeader);
    const rawTypeLabel = decode(stripTags(f.properties?.balloonContentType)).trim();
    const typeLabel = TYPE_NAME[rawTypeLabel] || (rawTypeLabel ? rawTypeLabel.slice(0, 1).toUpperCase() + rawTypeLabel.slice(1) : 'Пункт приёма вторсырья');

    const appKeys = [];
    for (const r of resources) for (const k of RESOURCE_TYPE[r] || []) if (!appKeys.includes(k)) appKeys.push(k);
    const labels = resources.map((r) => RESOURCE_LABEL[r]).filter(Boolean);
    const accepts = [...new Set([...appKeys, ...body.accepts, ...labels])].join(', ');

    const type = pickType(resources);
    typesCount.set(type, (typesCount.get(type) || 0) + 1);
    accessByName.set(typeLabel || '(пусто)', (accessByName.get(typeLabel || '(пусто)') || 0) + 1);

    let oblast = cleanName(city?.oblast || '');
    const settlement = cleanName(city?.name || '');
    if (settlement === 'Минск') oblast = 'г. Минск';
    const accessMode = /контейнер|площадка для сбора/.test(typeLabel) ? 'box' : 'counter';
    oblastCount.set(oblast, (oblastCount.get(oblast) || 0) + 1);

    rows.push({
      source_key: `t99:${f.id}`,
      source: 'target99',
      name: typeLabel,
      organization: body.organization,
      type,
      lat: f.geometry?.coordinates?.[0] ?? null,
      lng: f.geometry?.coordinates?.[1] ?? null,
      address: header,
      short_address: header.slice(0, 50),
      phone: body.phone,
      hours: body.hours,
      accepts,
      district: '',
      oblast,
      settlement,
      access_mode: accessMode,
      last_synced: new Date().toISOString().slice(0, 10),
      prices: null,
      logistics: null,
      description: null,
      transit: null,
      website: null,
    });
  }

  mkdirSync(DATA_DIR, { recursive: true });
  const outFile = join(DATA_DIR, 'target99-points.json');
  writeFileSync(outFile, JSON.stringify(rows, null, 1), 'utf8');

  console.log(`rows: ${rows.length}; unresolved cities: ${unresolved.size}`);
  console.log('types:', JSON.stringify(Object.fromEntries(typesCount)));
  console.log('names:', JSON.stringify(Object.fromEntries(accessByName), null, 0));
  console.log('oblasts:', JSON.stringify(Object.fromEntries(oblastCount)));
  console.log('sample:');
  for (const r of rows.slice(0, 3)) console.log(' ', JSON.stringify(r));
}

main().catch((err) => { console.error(err); process.exit(1); });