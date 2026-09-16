/**
 * Категоризация списка вещей по названию.
 * Сначала пробуем ИИ (Zhipu GLM-4-Flash) — как DeepSeek в связке,
 * но через имеющийся ключ Zhipu; при недоступности ИИ — офлайн-словарь.
 */
import { ITEM_CATEGORIES } from './moderation.js';
import { zhipuChat, zhipuKey, parseJsonEnvelope } from './zai.js';

const RULES = {
  Одежда: [
    'куртка', 'пальто', 'пуховик', 'шуба', 'плащ', 'ветровка', 'пиджак', 'жилет', 'костюм',
    'свитер', 'джемпер', 'кофта', 'кардиган', 'худи', 'толстовка', 'блуза', 'рубашка', 'футболка',
    'майка', 'топ', 'платье', 'сарафан', 'юбка', 'брюки', 'джинсы', 'штаны', 'шорты', 'бриджи',
    'рейтузы', 'легинсы', 'колготки', 'носок', 'носки', 'пижама', 'сорочка', 'халат', 'сарафан',
  ],
  Обувь: [
    'ботинок', 'ботинки', 'сапог', 'сапоги', 'кроссовк', 'кед', 'туфли', 'туфел', 'босоножк',
    'сандал', 'мокасин', 'угги', 'валенк', 'тапк', 'шлепк', 'полуботин', 'лодочк', 'каблук',
  ],
  Детям: [
    'игрушк', 'велосипед', 'самокат', 'кукла', 'конструктор', 'лего', 'пазл', 'мячик', 'мяч',
    'машинк', 'кубик', 'погремушк', 'коляск', 'кроватк', 'манеж', 'ступьчик', 'детск', 'детский',
    'детская', 'детское', 'подгузник', 'бутылочк', 'соск', 'развив', 'мишка', 'кукольн', 'раскраск',
    'альбом', 'книжк', 'погремушк',
  ],
  Мебель: [
    'стол', 'стул', 'кресло', 'диван', 'кровать', 'шкаф', 'комод', 'тумба', 'полка', 'стеллаж',
    'шкафчик', 'табурет', 'банкетк', 'пуф', 'сундук', 'зеркало', 'вешалк', 'кресл', 'матрас',
  ],
  Техника: [
    'телевизор', 'холодильник', 'стиральн', 'микроволнов', 'плита', 'духовк', 'пылесос', 'утюг',
    'фен', 'кофемашин', 'чайник', 'обогревател', 'кондиционер', 'вентилятор', 'посудомоечн',
    'сушилк', 'мультиварк', 'электроплит', 'печь', 'радиатор', 'увлажнитель',
  ],
  Электроника: [
    'телефон', 'смартфон', 'ноутбук', 'планшет', 'компьютер', 'монитор', 'клавиатура', 'мышка',
    'мышь', 'наушник', 'колонк', 'принтер', 'сканер', 'роутер', 'модем', 'гарнитур', 'камер',
    'фотоаппарат', 'видеорегистратор', 'переносн', 'зарядк', 'адаптер', 'гироскутер', 'часы',
    'электронн',
  ],
  Посуда: [
    'чашк', 'тарел', 'миск', 'кружк', 'блюдце', 'стакан', 'бокал', 'рюмк', 'кувшин', 'графин',
    'кастрюл', 'сковород', 'сотейник', 'казан', 'таз', 'дуршлаг', 'терк', 'нож', 'вилк', 'ложк',
    'ложка', 'набор посуды', 'сервиз', 'салатник', 'разделочн', 'доск', 'контейнер', 'термос',
    'бутылк', 'фужер',
  ],
  Книги: [
    'книг', 'учебник', 'энциклопедия', 'словарь', 'роман', 'рассказ', 'сказк', 'художественн',
    'детектив', 'фантастик', 'журнал', 'комикс', 'атлас', 'пособие', 'тетрад', 'брошюр', 'справочник',
  ],
  Спорт: [
    'гантел', 'штанга', 'тренажер', 'тренажёр', 'скакалк', 'обруч', 'коврик', 'маты', 'гиря',
    'эспандер', 'бокс', 'мяч', 'шайб', 'клюшк', 'лыж', 'коньк', 'санк', 'велосипед',
    'турник', 'степпер', 'беговая', 'фитнес', 'спортив',
  ],
  Инструменты: [
    'дрель', 'шуруповерт', 'шуруповёрт', 'перфоратор', 'молоток', 'отвертк', 'гаечн', 'ключ',
    'напильник', 'рубанок', 'лобзик', 'пила', 'ножовк', 'рулетк', 'уровень', 'паяльник',
    'мультиметр', 'тиск', 'станок', 'шланг', 'насос', 'струбцин', 'ножиц', 'инструмент',
  ],
  Красота: [
    'шампунь', 'гель', 'крем', 'маска', 'лак', 'тени', 'помада', 'тушь', 'карандаш', 'лосьон',
    'тоник', 'молочко', 'пенка', 'бальзам', 'сыворотк', 'спрей', 'мицеллярн', 'cкураб', 'скраб',
    'пилинг', 'макияж', 'косметичк', 'сумка', 'здесь комплект косметики',
  ],
  Растения: [
    'цветок', 'цветы', 'комнатн', 'растени', 'рассад', 'саженец', 'грунт', 'горшок', 'кашпо',
    'семен', 'луковиц', 'вазон', 'зелень', 'сад', 'кустарник', 'деревц', 'фиалк', 'орхиде',
  ],
  Животным: [
    'корм', 'миск', 'игрушк', 'поводок', 'ошейник', 'шлейк', 'клетк', 'переноск', 'лежанк',
    'домик', 'аквариум', 'наполнитель', 'лоток', 'когтеточк', 'амуниция', 'миска', 'подстилк',
  ],
};

const FALLBACK_BUCKETS = ['Одежда', 'Обувь', 'Детям', 'Мебель', 'Техника', 'Электроника', 'Посуда', 'Книги', 'Спорт', 'Инструменты', 'Красота', 'Растения', 'Животным'];

function normalize(s) {
  return String(s || '')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/[\s,.;:!?"'«»()\-–—/\\]+/g, ' ')
    .trim();
}

export function categorizeByRules(name) {
  const n = normalize(name);
  if (!n) return 'Другое';
  for (const cat of FALLBACK_BUCKETS) {
    const words = RULES[cat] || [];
    if (words.some((w) => n.includes(normalize(w)))) return cat;
  }
  return 'Другое';
}

function validCategory(c) {
  return ITEM_CATEGORIES.includes(c) ? c : null;
}

function readCategories(nodes, list) {
  // nodes — объект {название→категория} или массив [{name, category}]
  const map = new Map();
  if (Array.isArray(nodes)) {
    for (const el of nodes) {
      if (!el || typeof el !== 'object') continue;
      const cat = validCategory(String(el.category || '').trim());
      if (!cat) continue;
      const name = String(el.name || '').trim();
      const idx = list.findIndex((n) => n === name || normalize(n) === normalize(name));
      if (idx !== -1) map.set(list[idx], cat);
    }
    return map;
  }
  if (!nodes || typeof nodes !== 'object') return map;
  const keyIndex = new Map(list.map((name, i) => [normalize(name), i]));
  for (const [rawKey, rawValue] of Object.entries(nodes)) {
    const cat = validCategory(String(rawValue || '').trim());
    if (!cat) continue;
    const idx = keyIndex.get(normalize(String(rawKey)));
    if (idx != null) map.set(list[idx], cat);
  }
  return map;
}

/**
 * Пробуем ИИ (Zhipu). Возвращает Map названиe→категория либо null при недоступности.
 */
async function aiCategorize(list, opts = {}) {
  const apiKey = opts.apiKey || zhipuKey();
  if (!apiKey) return null;
  const numbered = list.map((n, i) => `${i + 1}. ${n}`);
  const system = [
    'Ты — сортировщик вещей для приложения безвозмездного обмена и переработки «EcoHub».',
    `Отнеси каждую вещь строго к ОДНОЙ категории из списка: ${ITEM_CATEGORIES.join(', ')}.`,
    'Если вещь не подходит ни к одной — используй «Другое».',
    'Верни ТОЛЬКО валидный JSON-объект вида {"вещь":"Категория", ...}, где ключи — дословные названия вещей из списка, значения — категории без изменений.',
  ].join('\n');
  const res = await zhipuChat(
    [{ role: 'system', content: system }, { role: 'user', content: distinctListText(numbered) }],
    {
      apiKey,
      model: opts.model,
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
      retries: opts.retries ?? 1,
      maxTokens: 900,
    },
  );
  if (!res.ok) return null;
  const parsed = parseJsonEnvelope(res.content);
  if (!parsed || typeof parsed !== 'object') return null;
  const map = readCategories(parsed, list);
  return map.size ? map : null;
}

function distinctListText(numbered) {
  return numbered.join('\n');
}

/**
 * Категоризация списка названий вещей.
 * @param {string[]} names
 * @param {object} [opts] — apiKey, model, fetchImpl, timeoutMs, retries
 * @returns {Promise<{items:Array<{name:string, category:string}>, provider:'ai'|'rules'}>}
 */
export async function categorizeItems(names, opts = {}) {
  const list = (Array.isArray(names) ? names : [])
    .map((n) => String(n ?? '').trim())
    .filter(Boolean)
    .slice(0, 60);
  if (!list.length) return { items: [], provider: 'rules' };

  let provider = 'rules';
  let byName = null;
  try {
    byName = await aiCategorize(list, opts);
    if (byName) provider = 'ai';
  } catch {
    byName = null;
  }

  const items = list.map((name) => ({
    name,
    category: validCategory(byName?.get(name)) || categorizeByRules(name),
  }));
  return { items, provider };
}