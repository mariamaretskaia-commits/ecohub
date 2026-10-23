import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Jimp from 'jimp';

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data/showcase');
const STICKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/stickers');

const W = 900;
const H = 1200;

const PHOTOS = [
  { file: '01-bike.jpg', main: 'sticker-sprout.png', from: [231, 246, 236], to: [255, 247, 227] },
  { file: '02-chair.jpg', main: 'sticker-listing.png', from: [243, 239, 231], to: [234, 243, 250] },
  { file: '03-jacket.jpg', main: 'sticker-clothes.png', from: [234, 241, 250], to: [253, 243, 234] },
  { file: '04-microwave.jpg', main: 'sticker-tech.png', from: [237, 243, 248], to: [239, 248, 242] },
  { file: '05-books.jpg', main: 'sticker-paper.png', from: [247, 241, 230], to: [234, 244, 239] },
];

function circleLayer(size, alpha) {
  const circle = new Jimp(size, size, 0x00000000);
  const c = size / 2;
  circle.scan(0, 0, size, size, function paint(x, y, idx) {
    const d = Math.hypot(x - c, y - c);
    if (d >= c) return;
    const a = Math.round(alpha * (1 - d / c));
    this.bitmap.data[idx] = 255;
    this.bitmap.data[idx + 1] = 255;
    this.bitmap.data[idx + 2] = 255;
    this.bitmap.data[idx + 3] = a;
  });
  return circle;
}

function fade(img, opacity) {
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function paint(x, y, idx) {
    this.bitmap.data[idx + 3] = Math.round(this.bitmap.data[idx + 3] * opacity);
  });
  return img;
}

async function makePhoto(spec) {
  const img = new Jimp(W, H, 0xffffffff);
  img.scan(0, 0, W, H, function paint(x, y, idx) {
    const t = Math.min(1, Math.max(0, (x / W) * 0.35 + (y / H) * 0.65));
    this.bitmap.data[idx] = Math.round(spec.from[0] + (spec.to[0] - spec.from[0]) * t);
    this.bitmap.data[idx + 1] = Math.round(spec.from[1] + (spec.to[1] - spec.from[1]) * t);
    this.bitmap.data[idx + 2] = Math.round(spec.from[2] + (spec.to[2] - spec.from[2]) * t);
    this.bitmap.data[idx + 3] = 255;
  });

  img.composite(circleLayer(620, 55), -180, -200);
  img.composite(circleLayer(560, 45), 640, 840);

  const main = await Jimp.read(path.join(STICKER_DIR, spec.main));
  main.resize(560, Jimp.AUTO);
  img.composite(main, Math.round((W - main.bitmap.width) / 2), 280);

  const accent = await Jimp.read(path.join(STICKER_DIR, 'sticker-recycle.png'));
  accent.resize(150, Jimp.AUTO);
  fade(accent, 0.85);
  img.composite(accent, 690, 960);

  img.quality(84);
  const out = path.join(OUT_DIR, spec.file);
  await img.writeAsync(out);
  console.log(`${spec.file}: ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const spec of PHOTOS) await makePhoto(spec);
