import { createClient } from '@supabase/supabase-js';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import Jimp from 'jimp';

let client;

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!client) client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/** Use memory uploads when photos go to cloud storage or DB embed. */
export function cloudStorageEnabled() {
  return Boolean(getClient() || process.env.DATABASE_URL || process.env.EMBED_PHOTOS === '1');
}

/**
 * Upload multer file → public URL / data URL / local path.
 * On Render without Supabase Storage, embed as data URL so photos survive ephemeral disk.
 */
export async function storeItemPhotos(files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return [];

  const sb = getClient();
  if (sb) {
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'item-photos';
    const urls = [];
    for (const file of list) {
      const ext = path.extname(file.originalname || file.filename || '').toLowerCase() || '.jpg';
      const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      const body = file.buffer || (file.path ? await fs.promises.readFile(file.path) : null);
      if (!body) continue;
      const { error } = await sb.storage.from(bucket).upload(name, body, {
        contentType: file.mimetype || 'image/jpeg',
        upsert: false,
      });
      if (error) throw Object.assign(new Error(`Фото: ${error.message}`), { status: 500 });
      const { data } = sb.storage.from(bucket).getPublicUrl(name);
      urls.push(data.publicUrl);
    }
    return urls;
  }

  if (process.env.DATABASE_URL || process.env.EMBED_PHOTOS === '1') {
    const urls = [];
    for (const file of list) {
      const body = file.buffer || (file.path ? await fs.promises.readFile(file.path) : null);
      if (!body) continue;
      const mime = file.mimetype || 'image/jpeg';
      urls.push(`data:${mime};base64,${Buffer.from(body).toString('base64')}`);
    }
    return urls;
  }

  return list.map((f) => `/uploads/${f.filename}`);
}

/**
 * Генерирует JPEG-миниатюру для ленты: центр. кроп под кадр карточки (3:4) и
 * ресайз до ≈1080×1440. ВАЖНО: `quality` у Jimp в шкале 0–100 (не 0–1),
 * поэтому дефолт 84, а не 0.85. Кроп сразу под карточку избавляет от
 * «зума» широких фото на клиенте, поэтому список выглядит чётко.
 * Ошибки не бросает – вернёт null для битого файла.
 */
export async function thumbDataUrl(buffer, { width = 1080, aspect = 3 / 4, quality = 84 } = {}) {
  try {
    if (!buffer || !buffer.length) return null;
    const img = await Jimp.read(buffer);
    const srcW = img.bitmap.width;
    const srcH = img.bitmap.height;
    if (!srcW || !srcH) return null;

    const srcAspect = srcW / srcH;
    let cropW;
    let cropH;
    if (srcAspect > aspect) {
      cropH = srcH;
      cropW = Math.round(cropH * aspect);
    } else {
      cropW = srcW;
      cropH = Math.round(cropW / aspect);
    }
    const x = Math.max(0, Math.round((srcW - cropW) / 2));
    const y = Math.max(0, Math.round((srcH - cropH) / 2));
    img.crop(x, y, cropW, cropH);

    const targetW = Math.min(Math.round(width), cropW);
    const targetH = Math.round(targetW / aspect);
    img.resize(targetW, targetH, Jimp.RESIZE_BICUBIC);

    const q = Math.max(1, Math.min(100, Math.round(quality)));
    const out = await img.quality(q).getBufferAsync(Jimp.MIME_JPEG);
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch (err) {
    console.warn('[storage] thumb failed:', err.message);
    return null;
  }
}

/** Создаёт массив миниатюр для multer-files (память/диск), параллельно до 3. */
export async function makeItemThumbs(files) {
  const list = Array.isArray(files) ? files : [];
  const bodies = [];
  for (const file of list) {
    bodies.push(file.buffer || (file.path ? await fs.promises.readFile(file.path) : null));
  }
  const thumbs = new Array(bodies.length);
  let next = 0;
  const worker = async () => {
    while (next < bodies.length) {
      const i = next;
      next += 1;
      thumbs[i] = await thumbDataUrl(bodies[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, bodies.length) }, worker));
  return thumbs;
}

/** Удаляет файлы фотографий из Supabase Storage или с локального диска. безобиден для data:/обычных URL. */
export async function deleteStoredPhotos(urls) {
  const list = (Array.isArray(urls) ? urls : []).filter(Boolean);
  for (const url of list) {
    if (String(url).startsWith('data:')) continue;
    const sb = getClient();
    if (sb && /\/storage\/v1\/object\/public\//.test(url)) {
      try {
        const seg = new URL(url).pathname.split('/').filter(Boolean);
        const bucket = seg.length >= 6 ? seg[4] : (process.env.SUPABASE_STORAGE_BUCKET || 'item-photos');
        const name = seg.slice(5).join('/');
        if (name) {
          const { error } = await sb.storage.from(bucket).remove([name]);
          if (error) console.warn('[storage] delete failed:', error.message);
        }
      } catch (err) {
        console.warn('[storage] delete skipped:', err.message);
      }
    } else if (url.startsWith('/uploads/')) {
      const file = path.join(__dirname, '..', 'data', 'uploads', path.basename(url));
      await fs.promises.unlink(file).catch(() => { /* noop */ });
    }
  }
}
