/**
 * Миниатюры ленты (storage.js thumbDataUrl).
 * Запуск: node --test tests/storage.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Jimp from 'jimp';
import { thumbDataUrl } from '../src/storage.js';

async function sampleJpeg(w = 1200, h = 1600) {
  const img = new Jimp(w, h);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const n = Math.floor(rnd() * 255);
      const i = img.getPixelIndex(x, y);
      img.bitmap.data[i] = (n + x) & 255;
      img.bitmap.data[i + 1] = (n + y) & 255;
      img.bitmap.data[i + 2] = (n * 3) & 255;
      img.bitmap.data[i + 3] = 255;
    }
  }
  return img.getBufferAsync(Jimp.MIME_JPEG);
}

test('thumbDataUrl: валидный JPEG 3:4 без апскейла', async () => {
  const src = await sampleJpeg();
  const out = await thumbDataUrl(src);
  assert.match(out, /^data:image\/jpeg;base64,/);

  const img = await Jimp.read(Buffer.from(out.split(',')[1], 'base64'));
  assert.equal(img.bitmap.width, 1080);
  assert.equal(img.bitmap.height, 1440);
});

test('thumbDataUrl: quality в шкале Jimp 0–100 (регрессия 0.85/85)', async () => {
  const src = await sampleJpeg();
  const hi = await thumbDataUrl(src, { quality: 84 });
  const lo = await thumbDataUrl(src, { quality: 1 });
  const hiBytes = Buffer.from(hi.split(',')[1], 'base64').length;
  const loBytes = Buffer.from(lo.split(',')[1], 'base64').length;
  assert.ok(
    hiBytes > loBytes * 3,
    `quality 84 (${hiBytes} B) должно быть заметно тяжелее quality 1 (${loBytes} B)`,
  );
});

test('thumbDataUrl: битый ввод → null', async () => {
  assert.equal(await thumbDataUrl(null), null);
  assert.equal(await thumbDataUrl(Buffer.alloc(0)), null);
  assert.equal(await thumbDataUrl(Buffer.from('not an image')), null);
});
