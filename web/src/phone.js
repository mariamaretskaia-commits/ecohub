export function firstPhone(value) {
  return String(value || '').split(/[,;]/)[0].trim();
}

export function telHref(value) {
  const raw = firstPhone(value);
  if (!raw) return '';
  let digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (/^7705$/.test(digits)) return 'tel:7705';
  if (digits.startsWith('80') && digits.length >= 11) digits = `+375${digits.slice(2)}`;
  else if (digits.startsWith('8') && digits.length >= 11) digits = `+375${digits.slice(1)}`;
  else if (digits.startsWith('375')) digits = `+${digits}`;
  else if (!digits.startsWith('+')) digits = `+${digits}`;
  return `tel:${digits}`;
}
