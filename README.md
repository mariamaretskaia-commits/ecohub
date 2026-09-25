# ♻️ EcoHub – Эко-экосистема Гродно

Telegram Mini App для конкурса **«100 идей для Беларуси»**.

Объединяет бесплатный шеринг вещей, интерактивную карту **35+ пунктов** утилизации с реальными адресами, районами и прайсами, а также геймификацию через Эко-коины.

## Возможности

| Вкладка | Функционал |
|---------|-----------|
| ♻️ **Шеринг** | Лента «Отдам даром» / «В шеринг», фильтры по району |
| 📍 **Эко-карта** | 35+ точек с адресами, районами, прайсами, режимом работы |
| 🪙 **Профиль** | Эко-коины, уровни, Эко-паспорт, топ активистов |
| ℹ️ **О проекте** | Описание для конкурса |

## Карта – источники данных

- **Заготторг** – 17 ларьков ([zagottorg.by/adresa](https://zagottorg.by/adresa/))
- **БелВТИ** – ул. Хвойная, 1 – от 0.30 BYN/кг ([belvtor.by](https://belvtor.by/branchs/))
- **Гродновторчермет** – 3 пункта ([grodnobvm.by](https://grodnobvm.by/))
- **Caritas** – ул. К. Маркса, 4
- **Красный Крест** – ул. Карбышева, 24; ул. Ожешко, 1
- **GRBO** – ул. Академическая, 2
- И другие социальные пункты

## Быстрый старт

```bash
cp .env.example .env
npm run install:all
npm run dev
```

- **Mini App**: http://localhost:5173
- **API**: http://localhost:3001

## Продакшен (24/7 без вашего ПК)

### Бесплатно: Render + Supabase

Пошагово: [`scripts/DEPLOY-FREE.md`](scripts/DEPLOY-FREE.md)

Нужны аккаунты [Supabase](https://supabase.com) и [Render](https://render.com) (бесплатно). Первый заход после паузы может занять до минуты.

### Локально + туннель (пока ноутбук включён)

```bash
npm run host
```

### Oracle / Railway

См. `scripts/oracle/README.md` (Oracle из РБ часто недоступен) и `npm run deploy:railway` (платно после триала).

## Лицензия

MIT – конкурс «100 идей для Беларуси», пилот г. Гродно.

## Модерация Trust & Safety (встроена в сервер)

Единый механизм модерации объявлений и чата переписки (порядок слоёв):

1. **Словарный фильтр** — наркотики, оружие, документы, фишинг, платёжные триггеры (включая обфускацию: символы, LEET, транслит, эмодзи-маскировку).
2. **Детектор ссылок** — whitelist доставщиков.
3. **ИИ-модерация** — NVIDIA Nemotron 3.5 Content Safety через OpenRouter (бесплатно; ловит обфускацию и подозрительные формулировки, хард-домен → блок, иначе ручная очередь), резервы: OpenAI omni-moderation → Zhipu GLM → публикация с меткой `pending_ai_review` (суммарный бюджет ≤ 2.8 с).
4. **Trust-скоринг отправителя** + авто-бан при 3+ жалобах за 30 дней.

- **block** – объявление/сообщение отклоняется (HTTP 400), создаётся жалоба в очередь
- **flag** – пропускается, попадает в очередь модерации, получатель видит кнопки в боте (жалоба / «это нормально»)
- **clean** – доставляется

### Переменные окружения

| Переменная | Назначение |
|---|---|
| `TRUST_ADMIN_TOKEN` | Токен админ-API (заголовок `X-Trust-Token`) |
| `TRUST_ADMIN_IDS` | Telegram id админов модерации (через запятую) |
| `OPENROUTER_API_KEY` | Ключ OpenRouter — ИИ-модерация Nemotron 3.5 Content Safety (бесплатная модель) |
| `OPENROUTER_MODEL` | Модель OpenRouter (по умолчанию `nvidia/nemotron-3.5-content-safety:free`) |
| `OPENROUTER_DISABLE_REASONING` | `1` — отключить reasoning (скорость) |
| `AI_MODERATION_BUDGET_MS` | Суммарный лимит ИИ-модерации, мс (по умолчанию 2800) |
| `AI_MODERATION_TIMEOUT_MS` | Таймаут одного ИИ-провайдера, мс (по умолчанию 2500) |
| `OPENAI_API_KEY` | Резервная ИИ-модерация omni-moderation (опционально) |
| `TRUST_BASE` / `TRUST_LOW_MIN` / `TRUST_HIGH_MAX` | Пороги trust-скоринга (по умолчанию 50 / 70 / 40) |
| `DATABASE_URL` | Postgres (прод). Если не задан / закомментирован — локальный SQLite |

### Локальный запуск

- Двойной клик по `start-local.cmd` в корне репозитория — сервер на `http://localhost:3001` (локальный SQLite, демо-данные создаются при первом старте).
- Вручную: `cd server && npm start`.
- Прод использует собственные env-переменные Render — файл `.env` на прод не влияет.

### Админский API (все с `X-Trust-Token`)

- `GET /api/trust/admin/alerts` – открытая очередь модерации
- `POST /api/trust/admin/confirm` `{report_id}` – подтвердить жалобу
- `POST /api/trust/admin/reject` `{report_id, reason}` – отклонить
- `POST /api/trust/admin/ban` `{telegram_id, reason, category, duration_days?}` – бан
- `POST /api/trust/admin/unban` `{telegram_id}` – разбан
- `GET /api/trust/admin/user/:telegramId` – досье пользователя (trust, жалобы, лог)

Тесты: `cd server && node --test tests/*.test.mjs` (117 unit-проверок) и `cd server && node tests/e2e.mjs` (31 сквозная проверка модерации/чата против SQLite).
