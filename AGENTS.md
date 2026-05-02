# despensa-bot — AGENTS.md

## Stack

- **Runtime**: Node.js + TypeScript
- **Bot framework**: Telegraf v4.16.3
- **Database**: Neon (PostgreSQL serverless) via `@neondatabase/serverless`
- **AI**: DeepSeek Chat via OpenAI SDK (`openai` npm package, base URL `https://api.deepseek.com`)
- **Scheduler**: Vercel Cron Jobs (production) / node-cron (local dev)
- **Deploy**: Vercel (serverless functions via `api/` routes)
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
    set-webhook.ts      # Script to configure Telegram webhook URL
api/
  webhook.ts            # Vercel serverless function: receives Telegram updates
  cron/
    expiration.ts       # Vercel Cron Job: daily expiration alerts at 9:00
tests/
  products.test.ts      # Mocked product repository tests
  shopping.test.ts      # Mocked shopping list repository tests
```

## Key architecture decisions

- **Dual mode**: `src/bot.ts` is the shared bot factory. `src/index.ts` uses long polling (local dev). `api/webhook.ts` uses webhooks (Vercel production).
- **Async DB**: All DB functions are async (Neon's `@neondatabase/serverless` returns promises).
- **Wizard state**: Stored in Telegraf's in-memory session (`MemorySessionStore`). Wizard steps are tracked via `session.wizard.step` string enum.
- **No Scenes**: Telegraf v4 scenes are deprecated. Wizard is implemented manually via session state + conditional routing in `bot.on('message')`.
- **Callback routing**: All inline button callbacks are handled in a single `bot.on('callback_query')` with `data.startsWith()` branching.
- **AI fallback**: Any unrecognized text message (not in wizard, not a command) is sent to DeepSeek with the full inventory as context.
- **DeepSeek model**: `deepseek-v4-flash` (NOT `deepseek-chat`, which is deprecated as of 2026-07-24).
- **Scheduler**: Local dev uses node-cron in-process. Production uses Vercel Cron Jobs (`vercel.json` crons section → `api/cron/expiration.ts`).
- **Webhook setup**: After deploying to Vercel, run `npm run set-webhook -- https://<project>.vercel.app/api/webhook` to configure Telegram.

## Vercel deployment

1. Push to GitHub
2. Import repo in Vercel
3. Set environment variables in Vercel dashboard:
   - `TELEGRAM_BOT_TOKEN`, `DEEPSEEK_API_KEY`, `TELEGRAM_ALLOWED_USERS`, `DATABASE_URL`
4. Deploy
5. Run: `npm run set-webhook -- https://<project>.vercel.app/api/webhook`

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
