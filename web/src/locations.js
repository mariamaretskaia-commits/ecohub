const TOWN = ['Центр', 'Весь населённый пункт'];

export const GRODNO_DISTRICTS = [
  'Ленинский',
  'Октябрьский',
];

const MINSK_DISTRICTS = [
  'Центр', 'Уручье', 'Зелёный Луг', 'Восток', 'Серебрянка', 'Чижовка', 'Шабаны',
  'Ангарская', 'Лошица', 'Малиновка', 'Юго-Запад', 'Каменная Горка', 'Сухарево',
  'Кунцевщина', 'Масюковщина', 'Курасовщина', 'Грушевка', 'Веснянка', 'Цна',
  'Степянка', 'Михалово', 'Брилевичи', 'Петровщина', 'Харьковская', 'Запад',
  'Новинки', 'Сокол', 'Дражня', 'Медвежино', 'Слепянка',
];

const BREST_DISTRICTS = ['Центр', 'Ковалёво', 'Восток', 'Южный', 'Гречихи', 'Вулька', 'Речица', 'Киевка'];
const VITEBSK_DISTRICTS = ['Центр', 'Битевля', 'Юг', 'Медведево', 'Черняховского', 'Зелёный Бор', 'Титова'];
const GOMEL_DISTRICTS = ['Центр', 'Волотова', 'Мельников Луг', 'Фестивальный', 'Западный', 'Новобелица', 'Медгородок', 'Хутор'];
const MOGILEV_DISTRICTS = ['Центр', 'Казимировка', 'Юбилейный', 'Гребенево', 'Спутник', 'Любуж', 'Мир-2'];
const BARANOVICHI_DISTRICTS = ['Центр', 'Боровки', 'Текстильщик', 'Южный', 'Брестский'];
const PINSK_DISTRICTS = ['Центр', 'Радужный', 'Западный', 'Северный'];
const LIDA_DISTRICTS = ['Центр', 'Сельмаш', 'Южный', 'Молодёжный'];
const BOBRUISK_DISTRICTS = ['Центр', 'Киселевичи', 'Слободка', 'Южный'];
const ORSHA_DISTRICTS = ['Центр', 'Заднепровье', 'Южный'];
const POLOTSK_DISTRICTS = ['Центр', 'Задвинье', 'Северный'];
const NOVOPOLOTSK_DISTRICTS = ['Центр', 'Веснянка', 'Боровуха'];
const MOZYR_DISTRICTS = ['Центр', 'Южный', 'Молодёжный'];
const SOLIGORSK_DISTRICTS = ['Центр', 'Первый', 'Второй', 'Третий', 'Четвёртый'];
const BORISOV_DISTRICTS = ['Центр', 'Фатимский', 'Печи', 'Новосёлки'];
const MOLODECHNO_DISTRICTS = ['Центр', 'Северный', 'Южный'];

function towns(...names) {
  return Object.fromEntries(names.map((n) => [n, TOWN]));
}

export const BELARUS = {
  'г. Минск': {
    Минск: MINSK_DISTRICTS,
  },
  'Гродненская область': {
    Гродно: GRODNO_DISTRICTS,
    Лида: LIDA_DISTRICTS,
    Слоним: TOWN,
    Волковыск: TOWN,
    Сморгонь: TOWN,
    Новогрудок: TOWN,
    Мосты: TOWN,
    Щучин: TOWN,
    Ошмяны: TOWN,
    Островец: TOWN,
    Скидель: TOWN,
    Берёзовка: TOWN,
    Ивье: TOWN,
    Дятлово: TOWN,
    Свислочь: TOWN,
    Зельва: TOWN,
    Кореличи: TOWN,
    Вороново: TOWN,
    'Большая Берестовица': TOWN,
  },
  'Минская область': {
    Борисов: BORISOV_DISTRICTS,
    Солигорск: SOLIGORSK_DISTRICTS,
    Молодечно: MOLODECHNO_DISTRICTS,
    Жодино: TOWN,
    Слуцк: TOWN,
    Дзержинск: TOWN,
    Вилейка: TOWN,
    'Марьина Горка': TOWN,
    Столбцы: TOWN,
    Несвиж: TOWN,
    Смолевичи: TOWN,
    Заславль: TOWN,
    Фаниполь: TOWN,
    Любань: TOWN,
    Клецк: TOWN,
    'Старые Дороги': TOWN,
    Узда: TOWN,
    Червень: TOWN,
    Березино: TOWN,
    Копыль: TOWN,
    Крупки: TOWN,
    Мядель: TOWN,
    Воложин: TOWN,
    Логойск: TOWN,
  },
  'Брестская область': {
    Брест: BREST_DISTRICTS,
    Барановичи: BARANOVICHI_DISTRICTS,
    Пинск: PINSK_DISTRICTS,
    Кобрин: TOWN,
    Берёза: TOWN,
    Ивацевичи: TOWN,
    Лунинцы: TOWN,
    Пружаны: TOWN,
    Столин: TOWN,
    Ганцевичи: TOWN,
    Дрогичин: TOWN,
    Жабинка: TOWN,
    Каменец: TOWN,
    Ляховичи: TOWN,
    Малорита: TOWN,
    Иваново: TOWN,
    Белоозёрск: TOWN,
    Высокое: TOWN,
    'Давид-Городок': TOWN,
    Микашевичи: TOWN,
  },
  'Витебская область': {
    Витебск: VITEBSK_DISTRICTS,
    Орша: ORSHA_DISTRICTS,
    Новополоцк: NOVOPOLOTSK_DISTRICTS,
    Полоцк: POLOTSK_DISTRICTS,
    Поставы: TOWN,
    Глубокое: TOWN,
    Лепель: TOWN,
    Новолукомль: TOWN,
    Городок: TOWN,
    Барань: TOWN,
    Браслав: TOWN,
    Верхнедвинск: TOWN,
    Докшицы: TOWN,
    Дубровно: TOWN,
    Миоры: TOWN,
    Сенно: TOWN,
    Толочин: TOWN,
    Чашники: TOWN,
    Шарковщина: TOWN,
    Бешенковичи: TOWN,
  },
  'Гомельская область': {
    Гомель: GOMEL_DISTRICTS,
    Мозырь: MOZYR_DISTRICTS,
    Жлобин: TOWN,
    Светлогорск: TOWN,
    Речица: TOWN,
    Калинковичи: TOWN,
    Рогачёв: TOWN,
    Добруш: TOWN,
    Житковичи: TOWN,
    Хойники: TOWN,
    Петриков: TOWN,
    Ельск: TOWN,
    Брагин: TOWN,
    'Буда-Кошелёво': TOWN,
    Ветка: TOWN,
    Лельчицы: TOWN,
    Лоев: TOWN,
    Наровля: TOWN,
    Чечерск: TOWN,
    Туров: TOWN,
  },
  'Могилёвская область': {
    Могилёв: MOGILEV_DISTRICTS,
    Бобруйск: BOBRUISK_DISTRICTS,
    Горки: TOWN,
    Осиповичи: TOWN,
    Кричев: TOWN,
    Климовичи: TOWN,
    Шклов: TOWN,
    Быхов: TOWN,
    Костюковичи: TOWN,
    Чаусы: TOWN,
    Мстиславль: TOWN,
    Кировск: TOWN,
    Кличев: TOWN,
    Краснополье: TOWN,
    Славгород: TOWN,
    Чериков: TOWN,
    Хотимск: TOWN,
    Белыничи: TOWN,
    Дрибин: TOWN,
    Круглое: TOWN,
    Глуск: TOWN,
  },
};

export const OBLASTS = Object.keys(BELARUS);

export function getSettlements(oblast) {
  if (!oblast || !BELARUS[oblast]) return [];
  return Object.keys(BELARUS[oblast]);
}

export function getDistricts(oblast, settlement) {
  if (!oblast || !settlement) return [];
  return BELARUS[oblast]?.[settlement] || TOWN;
}

export function formatLocation(item) {
  const parts = [item.settlement, item.district].filter(Boolean);
  return parts.join(' · ') || item.district || '';
}
