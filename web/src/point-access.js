export const ACCESS_MODES = {
  counter: {
    label: 'Касса',
    text: 'Сырьё принимает сотрудник, оплата по прайсу на месте.',
  },
  desk: {
    label: 'Приёмка',
    text: 'Вещи принимают как благотворительность, в часы работы пункта.',
  },
  box: {
    label: 'Контейнер',
    text: 'Железный бак: вещи можно пожертвовать самостоятельно.',
  },
};

export function accessInfo(point) {
  return ACCESS_MODES[point?.access_mode] || ACCESS_MODES.counter;
}
