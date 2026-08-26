import { createClient } from '@supabase/supabase-js';
import path from 'path';
import crypto from 'crypto';

let client;

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!client) client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export function cloudStorageEnabled() {
  return Boolean(getClient());
}

/**
 * Upload multer file (disk or memory) → public URL.
 * Falls back to local /uploads path when Supabase is not configured.
 */
export async function storeItemPhotos(files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return [];

  const sb = getClient();
  if (!sb) {
    return list.map((f) => `/uploads/${f.filename}`);
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'item-photos';
  const urls = [];

  for (const file of list) {
    const ext = path.extname(file.originalname || file.filename || '').toLowerCase() || '.jpg';
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const body = file.buffer || (file.path ? await import('fs').then((fs) => fs.promises.readFile(file.path)) : null);
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
