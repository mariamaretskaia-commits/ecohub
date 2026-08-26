import './loadEnv.js';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import { authMiddleware, optionalAuthMiddleware } from './auth.js';
import { registerUserRoutes, registerItemRoutes, registerPointRoutes } from './routes.js';
import { createBot, configureBot } from '../../bot/src/createBot.js';
import { initDb } from './db.js';
import { startPointSync } from './sync.js';
import { resolveWebAppUrl } from './env.js';
import { runSeed } from './seed.js';
import { cloudStorageEnabled } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const rawExt = path.extname(file.originalname || '').toLowerCase();
    const byMime = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/heic': '.heic',
      'image/heif': '.heif',
    };
    const ext = rawExt || byMime[file.mimetype] || '.jpg';
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage: cloudStorageEnabled() ? multer.memoryStorage() : diskStorage,
  limits: { fileSize: 12 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const name = String(file.originalname || '').toLowerCase();
    const okMime = mime.startsWith('image/') || mime === 'application/octet-stream';
    const okExt = /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(name) || !name;
    if (okMime || okExt) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

app.use(cors());
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ecohub' });
});

const botToken = process.env.BOT_TOKEN;
const webAppUrl = resolveWebAppUrl();
const bot = botToken && botToken !== 'your_bot_token_here'
  ? createBot(botToken, webAppUrl)
  : null;

if (bot) {
  app.use((req, res, next) => {
    if (req.path === '/telegram/webhook') console.log('🤖 Telegram update');
    next();
  });
  app.use(bot.webhookCallback('/telegram/webhook'));
}

app.use('/uploads', express.static(uploadsDir));

registerUserRoutes(app, authMiddleware);
registerItemRoutes(app, authMiddleware, upload, bot, optionalAuthMiddleware);
registerPointRoutes(app);

const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/telegram')) return next();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

async function setupTelegram(botInstance, url) {
  const hookUrl = `${url.replace(/\/$/, '')}/telegram/webhook`;
  try {
    await configureBot(botInstance, url);
    console.log(`🤖 Bot menu → ${url}`);
  } catch (err) {
    console.warn('Telegram menu was not set:', err.message);
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await botInstance.telegram.setWebhook(hookUrl, { drop_pending_updates: false });
      console.log(`🤖 Telegram webhook: ${hookUrl}`);
      return;
    } catch (err) {
      const msg = String(err.message || err);
      const raw = Number(msg.match(/retry after (\d+)/i)?.[1]);
      const waitSec = raw > 300 ? Math.ceil(raw / 1000) : (raw || 30 * (attempt + 1));
      const delay = Math.min(Math.max(waitSec, 5), 120);
      const retry = attempt < 5 ? ` (retry ${attempt + 1}/5, wait ${delay}s)` : '';
      console.warn(`Telegram webhook was not set${retry}:`, msg);
      if (attempt >= 5) return;
      await new Promise((r) => setTimeout(r, delay * 1000));
    }
  }
}

async function main() {
  await initDb();
  await runSeed();

  app.listen(PORT, async () => {
    console.log(`♻️ EcoHub API running on http://localhost:${PORT}`);
    if (webAppUrl) console.log(`🌐 Public URL: ${webAppUrl}`);
    if (cloudStorageEnabled()) console.log('☁️  Photos → Supabase Storage');
    startPointSync();
    if (bot && webAppUrl && webAppUrl.startsWith('https://')) {
      setupTelegram(bot, webAppUrl);
    }
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
