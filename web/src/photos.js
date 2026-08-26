/** Convert any image file (incl. HEIC via browser decode when possible) to JPEG File for reliable upload. */
export async function fileToJpeg(file, { maxSide = 1600, quality = 0.85 } = {}) {
  if (!file) return null;

  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (typeof bitmap.close === 'function') bitmap.close();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Не удалось обработать фото'))),
      'image/jpeg',
      quality,
    );
  });

  const base = String(file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Не удалось прочитать фото. Попробуйте JPEG или PNG.'));
      el.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function itemPhotos(item) {
  if (!item) return [];
  if (Array.isArray(item.photos) && item.photos.length) return item.photos.filter(Boolean);
  if (typeof item.photos === 'string' && item.photos.trim()) {
    try {
      const list = JSON.parse(item.photos);
      if (Array.isArray(list)) return list.filter(Boolean);
    } catch {
      /* ignore */
    }
  }
  return item.photo_url ? [item.photo_url] : [];
}

export function photoSrc(path) {
  if (!path) return '';
  const s = String(path);
  if (s.startsWith('http') || s.startsWith('data:') || s.startsWith('blob:')) return s;
  return `${import.meta.env.VITE_API_URL || ''}${s}`;
}
