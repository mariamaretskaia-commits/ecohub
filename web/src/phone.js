export function firstPhone(value) {
  return String(value || '').split(/[,;]/)[0].trim();
}

/** Нормализованный номер для набора: +375… / +7… / 7705 и т.п. */
export function dialNumber(value) {
  const raw = firstPhone(value);
  if (!raw) return '';
  let digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (/^7705$/.test(digits)) return '7705';
  if (digits.startsWith('80') && digits.length >= 11) digits = `+375${digits.slice(2)}`;
  else if (digits.startsWith('8') && digits.length >= 11) digits = `+375${digits.slice(1)}`;
  else if (digits.startsWith('375')) digits = `+${digits}`;
  else if (!digits.startsWith('+')) digits = `+${digits}`;
  return digits;
}

export function telHref(value) {
  const number = dialNumber(value);
  return number ? `tel:${number}` : '';
}

/** Синхронное копирование в буфер (внутри жеста). Возвращает успех. */
export function copyText(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    area.remove();
    if (ok) return true;
  } catch {
    /* fall through to async clipboard */
  }
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).catch(() => {});
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Открыть звонилку с подставленным номером (после копирования). */
export function openDialer(value) {
  const href = telHref(value);
  if (!href) return false;
  try {
    const link = document.createElement('a');
    link.href = href;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  } catch {
    try {
      window.location.href = href;
      return true;
    } catch {
      return false;
    }
  }
}
