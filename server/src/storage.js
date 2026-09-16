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
 * Генерирует JPEG-миниатюру (≈360px по большей стороне) для data/URL-фото,
 * чтобы лента была лёгкой. Ошибки не бросает — вернёт null для битого файла.
 */
export async function thumbDataUrl(buffer, { maxSide = 360, quality = 0.72 } = {}) {
  try {
    if (!buffer || !buffer.length) return null;
    const img = await Jimp.read(buffer);
    if (Math.max(img.bitmap.width, img.bitmap.height) > maxSide) {
      img.resize(maxSide, Jimp.AUTO);
    }
    const out = await img.quality(quality).getBufferAsync(Jimp.MIME_JPEG);
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch (err) {
    console.warn('[storage] thumb failed:', err.message);
    return null;
  }
}

/** Создаёт массив миниатюр для multer-files (память/диск), параллельно до 4. */
export async function makeItemThumbs(files) {
  const list = Array.isArray(files) ? files : [];
  const bodies = [];
  for (const file of list) {
    bodies.push(file.buffer || (file.path ? await fs.promises.readFile(file.path) : null));
  }
  const thumbs = [];
  for (let i = 0; i < bodies.length; i += 1) {
    thumbs.push(await thumbDataUrl(bodies[i]));
  }
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
