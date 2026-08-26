const ABUSE = [
  /х[уy][йиеяю]/i,
  /бл[яа](д|ть|дина)/i,
  /п[ие]зд/i,
  /еб(ать|ал|ала|али|ало|уч|ут|ёшь|ешь)/i,
  /ёб(ать|ал|нул|уч)/i,
  /заеб/i,
  /наеб/i,
  /съеб/i,
  /сука/i,
  /сучк/i,
  /мудак/i,
  /мудил/i,
  /гандон/i,
  /г[ао]ндон/i,
  /шлюх/i,
  /пидор/i,
  /пидар/i,
  /педик/i,
  /дебил/i,
  /идиот/i,
  /урод/i,
  /мраз/i,
  /тварь/i,
  /нахер/i,
  /нахуй/i,
  /похуй/i,
  /сволоч/i,
  /падла/i,
  /гнид/i,
  /fuck/i,
  /shit/i,
  /bitch/i,
  /asshole/i,
];

export function findAbuse(text) {
  const t = String(text || '').toLocaleLowerCase('ru');
  return ABUSE.some((re) => re.test(t));
}

export const ABUSE_MESSAGE = 'В объявлении нельзя писать брань и оскорбления. Исправьте текст.';
export const NICK_ABUSE_MESSAGE = 'Недопустимое имя';

function foldNick(text) {
  return String(text || '').toLocaleLowerCase('ru').replace(/ё/g, 'е');
}

const HARD_NICK = [
  /х[уy][йиеяю]/i,
  /бл[яа](д|ть|дина)/i,
  /п[ие]зд/i,
  /еб(ать|ал|ала|али|ало|уч|ут|ёшь|ешь|лан)/i,
  /ёб(ать|ал|нул|уч)/i,
  /заеб/i,
  /наеб/i,
  /съеб/i,
  /сука/i,
  /сучк/i,
  /мудак/i,
  /мудил/i,
  /гандон/i,
  /г[ао]ндон/i,
  /шлюх/i,
  /шалав/i,
  /пидор/i,
  /пидар/i,
  /педик/i,
  /нахер/i,
  /нахуй/i,
  /похуй/i,
  /fuck/i,
  /shit/i,
  /bitch/i,
  /asshole/i,
  /cunt/i,
  /nigger/i,
  /faggot/i,
  /kurwa/i,
  /chuj/i,
  /putain/i,
  /mierda/i,
  /scheisse/i,
  /hurensohn/i,
];

const SOLO_INSULT = new Set([
  'шаболда',
  'козел',
  'баран',
  'дурак',
  'идиот',
  'урод',
  'дебил',
  'даун',
  'гад',
  'мразь',
  'тварь',
  'сволочь',
  'падла',
  'гнида',
  'чмо',
  'лох',
  'кретин',
  'придурок',
  'скотина',
  'осел',
  'свинья',
]);

function hasHardNick(text) {
  const t = foldNick(text);
  return HARD_NICK.some((re) => re.test(t));
}

export function isForbiddenNickname(raw) {
  const name = foldNick(String(raw || '').trim().replace(/\s+/g, ' '));
  if (!name) return false;
  const words = name.split(' ').filter(Boolean);
  if (words.some((word) => hasHardNick(word))) return true;
  if (words.length === 1 && (hasHardNick(name) || SOLO_INSULT.has(words[0]))) return true;
  return false;
}

