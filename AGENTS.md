# despensa-bot — AGENTS.md

## Stack

- **Runtime**: Node.js + TypeScript
- **Bot framework**: Telegraf v4.16.3
- **Database**: Neon (PostgreSQL serverless) via `@neondatabase/serverless`
- **AI**: DeepSeek Chat via OpenAI SDK (`openai` npm package, base URL `https://api.deepseek.com`)
- **Scheduler**: node-cron (runs in-process, bot must stay running 24/7)
- **Deploy**: Render (Web Service, Node runtime)
- **Testing**: Vitest

## Dev commands

```bash
npm run dev          # tsx watch src/index.ts (hot reload, long polling)
npm run build        # tsc
npm start            # node dist/index.js
npm test             # vitest run
npm run test:watch   # vitest
npm run typecheck    # tsc --noEmit
npm run set-webhook  # tsx src/scripts/set-webhook.ts <URL>
```

## Environment

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `DEEPSEEK_API_KEY` | API key from platform.deepseek.com |
| `TELEGRAM_ALLOWED_USERS` | Comma-separated Telegram user IDs |
| `DATABASE_URL` | Neon PostgreSQL connection string |

Copy `.env.example` to `.env` and fill in values. The `.env` file is gitignored.

## Architecture

```
src/
  bot.ts                # Bot factory: middleware, handlers, routing (shared)
  index.ts              # Local dev entrypoint (long polling + node-cron)
  types/index.ts        # Shared types: Product, ShoppingItem, WizardStep, etc.
  utils/config.ts       # Env-based config singleton
  db/
    schema.ts           # Neon connection + CREATE TABLE statements
    index.ts            # Re-exports
    products.ts         # Product CRUD (async, template-tagged SQL)
    shopping.ts         # Shopping list CRUD
    movements.ts        # Movement log
  middleware/
    auth.ts             # User whitelist check
    session.ts          # Telegraf session (in-memory)
  handlers/
    start.ts            # /start command + persistent keyboard
    pantry.ts           # Browse products by zone with pagination
    add.ts              # 6-step wizard for adding products
    consume.ts          # Consume/use products flow
    shopping.ts         # Shopping list with toggle/share/clear
  services/
    deepseek.ts         # OpenAI SDK → DeepSeek, builds inventory context
    scheduler.ts        # Local-only: daily 9:00 AM expiration alerts via node-cron
  scripts/
    set-webhook.ts      # Script to configure Telegram webhook URL (for webhook-based deploys)
tests/
  products.test.ts      # Mocked product repository tests
  shopping.test.ts      # Mocked shopping list repository tests
```

## Key architecture decisions

- **Long polling**: Bot uses long polling (not webhooks). Must stay running 24/7.
- **Async DB**: All DB functions are async (Neon's `@neondatabase/serverless` returns promises).
- **Wizard state**: Stored in Telegraf's in-memory session (`MemorySessionStore`). Wizard steps are tracked via `session.wizard.step` string enum.
- **No Scenes**: Telegraf v4 scenes are deprecated. Wizard is implemented manually via session state + conditional routing in `bot.on('message')`.
- **Callback routing**: All inline button callbacks are handled in a single `bot.on('callback_query')` with `data.startsWith()` branching.
- **AI fallback**: Any unrecognized text message (not in wizard, not a command) is sent to DeepSeek with the full inventory as context.
- **DeepSeek model**: `deepseek-v4-flash` (NOT `deepseek-chat`, which is deprecated as of 2026-07-24).
- **Scheduler**: Runs in-process via node-cron. Bot must stay running 24/7 for alerts to work.

## Render deployment

1. Push to GitHub
2. In Render dashboard, create a new **Web Service**
3. Connect your GitHub repo
4. Set:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `node dist/index.js`
5. Add environment variables in Render dashboard:
   - `TELEGRAM_BOT_TOKEN`, `DEEPSEEK_API_KEY`, `DATABASE_URL`
6. Deploy

## Testing quirks

- DB is **mocked** via `vi.mock('../src/db/schema')` — no real Neon connection needed.
- Mock state is reset via `resetState()` in each `beforeEach`.
- The mock intercepts tagged template SQL and simulates CRUD on an in-memory array.
- Tests are in `tests/` (not `src/`), matching `vitest.config.ts` include pattern.

## Conventions

- Respond in Spanish; code and comments in English
- One responsibility per agent, one commit per responsibility
- Tests required before merge
- Security audit required for auth/sensitive data changes
