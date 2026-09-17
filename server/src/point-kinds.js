/**
 * «Виды приёма» (kinds) — общий язык между вещами и пунктами.
 *
 * Требование продукта: пункт подходит вещи только если её вид реально входит
 * в перечень приёма пункта. Иначе — честно «Пункт не найден». Категории для
 * этого слишком грубые («Красота и здоровье» — это и памперсы, и духи),
 * поэтому вводим более мелкие виды.
 *
 * Перечень приёма пункта (`accept_kinds`) выводится из его официального
 * описания `accepts`/`type` (derivePointKinds). Для пунктов, где официальный
 * текст скупой, можно задать точечные оверрайды в data/point-kind-overrides.json
 * (по source_key). Итоговые виды хранятся в колонке recycling_points.accept_kinds.
 */
import fs from 'fs';

export const KINDS = [
  'paper', 'glass', 'plastic', 'electronics', 'metal', 'hazardous',
  'textile', 'hygiene', 'cosmetics', 'jewelry', 'health',
  'household', 'furniture', 'books', 'toys', 'food',
  'sports', 'garden', 'pet', 'auto',
];

/** Смешанные категории: вид определяется по названию вещи, а не по категории. */
const MIXED_CATEGORIES = new Set(['Красота и здоровье']);

/** Категория вещи → виды приёма по умолчанию. */
export const CATEGORY_KINDS = {
  'Авто и запчасти': ['metal', 'auto', 'hazardous'],
  'Ремонт и стройка': ['metal', 'household'],
  'Хобби, спорт и туризм': ['books', 'sports', 'textile', 'plastic', 'metal'],
  'Всё для детей и мам': ['textile', 'kids', 'hygiene', 'toys'],
  'Мебель': ['furniture'],
  'Одежда': ['textile'],
  'Для животных': ['pet'],
  'Всё для дома': ['household', 'books', 'glass', 'plastic', 'metal', 'paper'],
  'Телефоны и планшеты': ['electronics'],
  'Сад и огород': ['garden', 'plastic', 'metal'],
  'Электроника': ['electronics'],
  'Компьютерная техника': ['electronics'],
  'Бытовая техника': ['electronics'],
  'Красота и здоровье': ['hygiene', 'cosmetics', 'jewelry', 'health'],
  'Другое': [],
};

/** Стем/фраза в названии вещи → вид. Порядок не важен: виды объединяются. */
const NAME_RULES = [
  ['hygiene', ['прокладк', 'памперс', 'подгузник', 'туалетн', 'пеленк', 'салфетк', 'мыло',
    'шампун', 'зубн', 'гигиен', 'дезодорант', 'ватн', 'бритв', 'гель для душ', 'пена для брит']],
  ['cosmetics', ['духи', 'парфюм', 'помад', 'тушь', 'пудр', 'тени', 'косметик', 'крем',
    'блеск для губ', 'румяна', 'консилер', 'тональн', 'лак']],
  ['jewelry', ['бусы', 'серьг', 'браслет', 'кольц', 'цепочк', 'бижутер', 'брошь', 'подвеск', 'ожерел']],
  ['health', ['тонометр', 'глюкометр', 'аптечк', 'ингалятор', 'костыл', 'ортопед', 'градусник', 'термометр', 'грелк']],
  ['books', ['книг', 'журнал', 'газет', 'учебник', 'тетрад', 'энциклопед', 'комикс']],
  ['paper', ['макулатур', 'картон']],
  ['plastic', ['пластик', 'пэт', 'пластмасс', 'полимер']],
  ['glass', ['стекл', 'стеклотар']],
  ['metal', ['металл', 'медь', 'желез', 'алюмин', 'латунь', 'чугун']],
  ['electronics', ['телефон', 'смартфон', 'планшет', 'ноутбук', 'компьютер', 'монитор',
    'телевизор', 'холодильник', 'стиральн', 'пылесос', 'микроволнов', 'наушник', 'колонк',
    'фотоаппарат', 'камер', 'клавиатур', 'принтер', 'зарядк', 'провод', 'кабел', 'батарейк',
    'фен', 'утюг', 'чайник', 'электро']],
  ['textile', ['платье', 'юбк', 'блуз', 'рубашк', 'футболк', 'носк', 'куртк', 'шапк', 'шарф',
    'кроссовк', 'обув', 'сапог', 'ботинк', 'пальто', 'джинс', 'костюм', 'свитер', 'кофт',
    'бель', 'одежд', 'текстил', 'постельн', 'полотенц', 'штор']],
  ['toys', ['игрушк', 'конструктор', 'кукл', 'машинк', 'погремушк', 'лего', 'пазл', 'настольн игр']],
  ['kids', ['детск', 'коляск', 'слинг', 'бутылочк', 'пустышк', 'соск']],
  ['household', ['посуд', 'тарелк', 'кастрюл', 'чашк', 'кружк', 'ложк', 'вилк', 'контейнер',
    'утвар', 'ковер', 'ковр', 'подушк', 'одеял', 'светильник', 'ваз', 'коробк', 'вешалк']],
  ['furniture', ['мебел', 'диван', 'шкаф', 'кроват', 'матрас', 'комод', 'тумб', 'полк', 'кресл', 'пуфик', 'столик']],
  ['food', ['продукт', 'консерв', 'крупа', 'макарон', 'еда']],
  ['sports', ['велосипед', 'гантел', 'гир', 'палатк', 'рюкзак', 'мяч', 'тренажер', 'лыж', 'коньк', 'скейт', 'самокат', 'спорт']],
  ['garden', ['рассад', 'семен', 'грунт', 'горшок', 'лейк', 'садов', 'теплиц', 'удобрен', 'лопат', 'грабл']],
  ['pet', ['корм', 'клетк', 'переноск', 'поводок', 'ошейник', 'лежанк', 'аквариум', 'террариум', 'лоток', 'питомц']],
  ['auto', ['автошин', 'покрышк', 'автозапчаст', 'авточехл', 'автокресл', 'бампер']],
  ['hazardous', ['акб', 'батарейк', 'ламп', 'ртут', 'автомасл', 'масл', 'растворител', 'аэрозол', 'хими']],
];

/** Текст официального перечня пункта → виды. */
const POINT_RULES = [
  [['paper'], ['макулатур', 'бумаг', 'картон']],
  [['glass'], ['стекл', 'стеклотар', 'стеклобой']],
  [['plastic'], ['пэт', 'пластик', 'полимер', 'пластмасс']],
  [['electronics'], ['техник', 'электроник', 'электроприбор', 'плат', 'радиодетал', 'бытов']],
  [['metal'], ['металл', 'металлолом', 'медь', 'цветн', 'желез', 'алюмин', 'латунь', 'чугун']],
  [['hazardous'], ['акб', 'батаре', 'элемент', 'автошин', 'автомасл', 'масл', 'ламп', 'ртут', 'опасн', 'шин']],
  [['textile'], ['одежд', 'обув', 'постельн', 'тепл', 'ветошь', 'текстил', 'ношен']],
  [['hygiene'], ['гигиен']],
  // Гуманитарная помощь — вещи и предметы первой необходимости для нуждающихся.
  [['textile', 'hygiene', 'kids', 'books', 'household', 'toys', 'food'], ['гуманитарн']],
  [['food'], ['продукт']],
  [['books'], ['книг']],
  [['toys'], ['игрушк']],
  [['household'], ['посуда', 'утвар', 'хозтовар', 'товар']],
  [['furniture'], ['мебел']],
  [['pet'], ['корм', 'животн', 'питомц', 'зоо']],
  [['garden'], ['сад', 'огород', 'растен', 'грунт', 'семена']],
  [['sports'], ['спорт', 'туризм']],
];

/** Точные токены (латиница/ключи видов) → вид. */
const DIRECT = {
  paper: 'paper', glass: 'glass', plastic: 'plastic', electronics: 'electronics',
  metal: 'metal', hazardous: 'hazardous', clothing: 'textile', textile: 'textile',
  hygiene: 'hygiene', cosmetics: 'cosmetics', jewelry: 'jewelry', health: 'health',
  household: 'household', furniture: 'furniture', books: 'books', toys: 'toys',
  food: 'food', sports: 'sports', garden: 'garden', pet: 'pet', auto: 'auto',
};

const TYPE_TO_KIND = {
  paper: 'paper', glass: 'glass', plastic: 'plastic', electronics: 'electronics',
  metal: 'metal', hazardous: 'hazardous', clothing: 'textile',
};

let OVERRIDES = {};
try {
  OVERRIDES = JSON.parse(
    fs.readFileSync(new URL('./data/point-kind-overrides.json', import.meta.url), 'utf8'),
  );
} catch {
  OVERRIDES = {};
}

function norm(s) {
  return String(s || '')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/[\s,.;:!?"'«»()\-––/\\+]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchRules(text, rules) {
  const s = norm(text);
  if (!s) return [];
  const words = s.split(' ').filter(Boolean);
  const out = new Set();
  for (const [kinds, stems] of rules) {
    const list = Array.isArray(kinds) ? kinds : [kinds];
    for (const stem of stems) {
      const hit = stem.includes(' ')
        ? s.includes(stem)
        : words.some((w) => w.startsWith(stem));
      if (hit) {
        list.forEach((k) => out.add(k));
        break;
      }
    }
  }
  return [...out];
}

/** Виды вещи: для смешанных категорий название важнее категории. */
export function kindsForItem(name, category) {
  const base = CATEGORY_KINDS[category] || [];
  const byName = matchRules(name, NAME_RULES);
  if (MIXED_CATEGORIES.has(category)) return byName.length ? byName : base;
  return [...new Set([...base, ...byName])];
}

/** Выводит виды приёма пункта из официального текста accepts/type. */
export function derivePointKinds(point) {
  const key = String(point?.source_key || '');
  const override = key && Array.isArray(OVERRIDES[key])
    ? OVERRIDES[key].filter((k) => KINDS.includes(k))
    : null;
  if (override && override.length) return override;

  const out = new Set();
  const tokens = String(point?.accepts || '')
    .split(',')
    .map((t) => norm(t))
    .filter(Boolean);
  if (!tokens.length && point?.type) tokens.push(norm(point.type));

  for (const token of tokens) {
    if (DIRECT[token]) out.add(DIRECT[token]);
    matchRules(token, POINT_RULES).forEach((k) => out.add(k));
  }
  const typeKind = TYPE_TO_KIND[norm(point?.type)];
  if (typeKind) out.add(typeKind);
  return [...out];
}

/** Итоговые виды пункта: сохранённые accept_kinds, иначе вывод из accepts. */
export function pointKindsFor(point) {
  const stored = String(point?.accept_kinds || '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => KINDS.includes(t));
  if (stored.length) return stored;
  return derivePointKinds(point);
}

export function hasKindOverlap(acceptedKinds, wantedKinds) {
  if (!wantedKinds?.length) return false;
  return wantedKinds.some((k) => acceptedKinds.includes(k));
}
