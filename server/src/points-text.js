/**
 * Очистка текстов пунктов приёма от скрап-мусора: HTML-тегов (`<strong>`,
 * битые `‹strong>`), сущностей (`&nbsp;`, `&amp;`, числовых) и обрывков `...`.
 * Плюс эвристика «SEO-спам» — такие описания не несут смысла и скрываются.
 */

const NAMED_ENTITIES = {
  nbsp: ' ',
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  laquo: '«',
  raquo: '»',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  deg: '°',
  times: '×',
  middot: '·',
};

export function decodeEntities(raw) {
  return String(raw ?? '').replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, code) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X';
      const num = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(num) || num <= 0 || num > 0x10ffff) return '';
      try {
        return String.fromCodePoint(num);
      } catch {
        return '';
      }
    }
    const key = code.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match;
  });
}

export function stripTags(raw) {
  return String(raw ?? '')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/[‹<]\s*\/?\s*[a-zа-я][^>›]*[>›]/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
}

/**
 * Приводит текст пункта к читаемому виду. Пустая строка, если после очистки
 * ничего осмысленного не осталось.
 */
export function cleanPointText(raw) {
  if (raw == null) return '';
  let s = decodeEntities(String(raw));
  s = stripTags(s);
  s = s.replace(/\u00a0/g, ' ');
  s = s.replace(/\.{2,}/g, ' ').replace(/…+/g, ' ');
  s = s.replace(/[ \t\r\f\v]+/g, ' ');
  s = s.replace(/\s*\n\s*/g, '\n');
  s = s.replace(/\s*([,;:])\s*/g, '$1 ');
  s = s.replace(/([,;:])(?:\s*[,;:])+/g, '$1');
  s = s.replace(/ {2,}/g, ' ');
  s = s.replace(/^[\s,;:.–—-]+|[\s,;:.–—-]+$/g, '');
  return s.trim();
}

const SPAM_MARKERS = [
  'адреса профсоюзов',
  'общества и союзы',
  'перечень общественных',
  'общественно-политические организации',
  'общественные объединения беларуси',
];

/**
 * Похоже ли описание на скрап-спам: маркеры каталогов, россыпь «...» или
 * длинная цепочка перечислений без единого предложения. Такие тексты не
 * показываем вовсе.
 */
export function isSpammyDescription(raw) {
  const cleaned = cleanPointText(raw);
  if (!cleaned) return false;
  const lower = cleaned.toLowerCase();
  if (SPAM_MARKERS.some((marker) => lower.includes(marker))) return true;

  const ellipses = (String(raw).match(/\.{2,}|…/g) || []).length;
  if (ellipses >= 2) return true;

  const fragments = cleaned.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  const hasSentence = /[.!?]/.test(cleaned);
  const words = cleaned.split(/\s+/).filter(Boolean).length;
  return fragments.length >= 6 && !hasSentence && words >= 12;
}

/** Очищает поле пункта; спамные описания/логистику обнуляет. */
export function cleanPointField(field, raw) {
  if (field === 'description' || field === 'logistics') {
    if (isSpammyDescription(raw)) return '';
  }
  return cleanPointText(raw);
}
