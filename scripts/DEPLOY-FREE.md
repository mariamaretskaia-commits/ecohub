# EcoHub без ноутбука (бесплатно): Render + Supabase

Мини-приложение и бот живут в облаке. Первый заход после паузы может занять до минуты (экран «Загружается…»).

## Шаг 1. Supabase (база + фото)

1. Зарегистрируйтесь: https://supabase.com (можно через GitHub).
2. **New project** → имя `ecohub` → регион ближе к EU → пароль БД сохраните.
3. **SQL Editor** → New query → вставьте весь файл  
   `server/sql/supabase-schema.sql` → **Run**.
4. **Storage** → New bucket → имя `item-photos` → **Public bucket** → Create.
5. **Project Settings → API**:
   - `Project URL` → это `SUPABASE_URL`
   - `service_role` (secret) → это `SUPABASE_SERVICE_ROLE_KEY`
6. **Project Settings → Database → Connection string → URI**  
   (режим **Transaction** / pooler, порт **6543**):  
   скопируйте → это `DATABASE_URL`  
   (подставьте пароль вместо `[YOUR-PASSWORD]`).

## Шаг 2. Render (сервер 24/7 в облаке)

1. https://render.com → Sign up.
2. **New → Blueprint** или **New → Web Service** → подключите GitHub-репозиторий с EcoHub  
   **или** **New → Web Service** → Deploy from existing image / Docker: Root directory = проект, Dockerfile в корне.
3. Если без GitHub: **Web Service** → upload не всегда есть; проще залить код на GitHub (приватный ок).
4. Runtime: **Docker** (есть `Dockerfile` в корне).
5. Plan: **Free**.
6. Environment variables:

| Key | Value |
|-----|--------|
| `BOT_TOKEN` | токен из BotFather |
| `DATABASE_URL` | URI из Supabase |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role |
| `SUPABASE_STORAGE_BUCKET` | `item-photos` |
| `WEBAPP_URL` | пока пусто – заполните после первого деплоя |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | любая длинная строка |

7. Deploy → дождитесь **Live**.
8. Скопируйте URL вида `https://ecohub-xxxx.onrender.com`.
9. В Render → Environment → `WEBAPP_URL=https://ecohub-xxxx.onrender.com` → Save → Redeploy.
10. Локально (или через Render Shell):

```bash
# с WEBAPP_URL и BOT_TOKEN в .env
npm run bot:setup
```

Или откройте в браузере после деплоя – сервер сам выставит webhook при старте, если `WEBAPP_URL` задан.

## Шаг 3. Проверка

1. `https://ВАШ.onrender.com/health` → `{"ok":true,"service":"ecohub"}`
2. Telegram → `@EcoHubBY_bot` → `/start` → EcoHub
3. Ноутбук можно выключить.

## Важно

- Free Render **засыпает** ~через 15 мин без трафика. Первый человек после паузы ждёт до ~1 мин.
- Бесплатная БД Supabase постоянная (в лимитах free).
- Не публикуйте `service_role` и `BOT_TOKEN` в чатах.

## Если нет GitHub

Можно создать приватный репозиторий и запушить проект, либо попросить помочь с `git` / загрузкой – напишите.
