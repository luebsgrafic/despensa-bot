import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import express from 'express';

// ── 1. Load .env ───────────────────────────────────────
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log('[Config] Loaded .env from:', envPath);
}

import { initializeSchema } from './db/schema';
import { createBot } from './bot';
import { config } from './utils/config';
import { startScheduler, startWeeklySummary } from './services/scheduler';

// ── 2. Validate environment ────────────────────────────
const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!WEBHOOK_URL) {
  console.error('[FATAL] WEBHOOK_URL is not set in .env');
  console.error('Add: WEBHOOK_URL=https://luesbgrafic.duckdns.org/api/webhook');
  process.exit(1);
}

if (WEBHOOK_URL.includes('localhost')) {
  console.error('[FATAL] WEBHOOK_URL cannot be localhost in production');
  console.error('Set: WEBHOOK_URL=https://luesbgrafic.duckdns.org/api/webhook');
  process.exit(1);
}

console.log('[Config] PORT:', PORT);
console.log('[Config] WEBHOOK_URL:', WEBHOOK_URL);
console.log('[Config] GEMINI_MODEL:', config.geminiModel);

// ── 3. Initialize database schema ──────────────────────
async function initDb(): Promise<void> {
  try {
    await initializeSchema();
    console.log('[DB] Schema initialized successfully');
  } catch (error) {
    console.error('[DB] Failed to initialize schema:', error);
    process.exit(1);
  }
}

// ── 4. Create bot ──────────────────────────────────────
const bot = createBot();

// ── 4. Safe webhook setup ──────────────────────────────
async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setupWebhook(): Promise<void> {
  try {
    const info = await bot.telegram.getWebhookInfo();

    if (info.url === WEBHOOK_URL) {
      console.log('[Webhook] Already set to:', WEBHOOK_URL);
      return;
    }

    console.log('[Webhook] Current URL:', info.url || '(empty)');
    console.log('[Webhook] Setting to:', WEBHOOK_URL);

    await bot.telegram.setWebhook(WEBHOOK_URL!);
    console.log('[Webhook] Set successfully');
  } catch (error: any) {
    const retryAfter = error?.response?.parameters?.retry_after;

    if (retryAfter) {
      console.log('[Webhook] Rate limited. Waiting', retryAfter, 'seconds...');
      await sleep((retryAfter + 1) * 1000);

      try {
        await bot.telegram.setWebhook(WEBHOOK_URL!);
        console.log('[Webhook] Set successfully after retry');
        return;
      } catch (retryError: any) {
        console.error('[Webhook] Retry also failed:', retryError?.message);
        // Non-fatal: server can still run, webhook may already be set
      }
    } else {
      console.error('[Webhook] Failed to set webhook:', error?.message);
      // Non-fatal: continue and let the server run
    }
  }
}

// ── 5. Express server ──────────────────────────────────
const app = express();
app.use(express.json());
app.use(bot.webhookCallback('/api/webhook'));

app.get('/api/webhook', (_req, res) => {
  res.json({ status: 'ok', bot: 'DespensaBot' });
});

// ── 6. Start ───────────────────────────────────────────
app.listen(PORT, async () => {
  console.log('[Server] Listening on port', PORT);
  await initDb();
  await setupWebhook();
});

startScheduler(bot);
startWeeklySummary(bot);

// ── 7. Graceful shutdown ───────────────────────────────
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
