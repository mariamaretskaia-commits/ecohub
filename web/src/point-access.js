export const ACCESS_MODES = {
  counter: {
    label: 'Пункт переработки',
    text: 'Принимают сырьё и платят по прайсу.',
  },
  desk: {
    label: 'Центр помощи',
    text: 'Принимают вещи для нуждающихся бесплатно, в часы работы.',
  },
  box: {
    label: 'Контейнер',
    text: 'Можно положить вещи самостоятельно в любое время.',
  },
};

export function accessInfo(point) {
  return ACCESS_MODES[point?.access_mode] || ACCESS_MODES.counter;
}
