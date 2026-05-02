import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env FIRST, before any other imports
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log('[Config] Loaded .env from:', envPath);
} else {
  console.warn('[Config] No .env file found at:', envPath);
}

import express from 'express';
import { createBot } from './bot';
import { startScheduler } from './services/scheduler';

const bot = createBot();

const PORT = parseInt(process.env.PORT || '3000', 10);
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!WEBHOOK_URL) {
  console.error('[FATAL] WEBHOOK_URL is not set in .env or environment');
  process.exit(1);
}

console.log('[Config] PORT:', PORT);
console.log('[Config] WEBHOOK_URL:', WEBHOOK_URL);

/**
 * Check if the webhook is already set to the correct URL.
 * Only calls setWebhook if the current URL differs.
 */
async function ensureWebhook(url: string, maxRetries = 5): Promise<void> {
  // 1. Check current webhook status
  try {
    const info = await bot.telegram.getWebhookInfo();
    if (info.url === url) {
      console.log(`[Webhook] Already set to: ${url} — skipping registration`);
      return;
    }
    if (info.url) {
      console.log(`[Webhook] Current URL differs: "${info.url}" -> "${url}"`);
    }
  } catch (error: any) {
    console.warn('[Webhook] Could not get current webhook info:', error?.message);
  }

  // 2. Set webhook with retry on 429
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await bot.telegram.setWebhook(url);
      if (result) {
        console.log(`[Webhook] Set successfully to: ${url}`);
        return;
      }
    } catch (error: any) {
      if (error?.response?.statusCode === 429) {
        const retryAfter = error?.response?.parameters?.retry_after || 10;
        const waitMs = retryAfter * 1000 + attempt * 2000;
        console.warn(
          `[Webhook] Rate limited (429). Retry ${attempt}/${maxRetries} in ${waitMs}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      } else {
        throw error;
      }
    }
  }
  throw new Error(`Failed to set webhook after ${maxRetries} retries`);
}

async function main() {
  // 1. Ensure webhook is registered (skips if already correct)
  await ensureWebhook(WEBHOOK_URL!);

  // 2. Express server — NO bot.launch(), NO bot.createWebhook()
  const app = express();

  // Health check for nginx
  app.get('/api/webhook', (_req, res) => {
    res.status(200).json({ status: 'ok', bot: 'DespensaBot' });
  });

  // Webhook endpoint — raw Buffer body, Telegraf handles parsing
  app.post('/api/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    try {
      if (!req.body || Buffer.byteLength(req.body as any) === 0) {
        console.warn('[Webhook] Empty body received');
        res.status(200).json({ ok: true });
        return;
      }

      const rawBody = (req.body as Buffer).toString('utf8');
      const update = JSON.parse(rawBody);

      await bot.handleUpdate(update);
      res.status(200).json({ ok: true });
    } catch (error: any) {
      console.error('[Webhook] Error processing update:', error?.message);
      // Always return 200 to Telegram so it doesn't retry indefinitely
      res.status(200).json({ ok: true });
    }
  });

  // 3. Start listening
  app.listen(PORT, () => {
    console.log(`🤖 DespensaBot is running (webhook mode on port ${PORT})!`);
    console.log(`🔗 Webhook URL: ${WEBHOOK_URL}`);
  });

  // 4. Scheduler for daily alerts
  startScheduler(bot);

  // 5. Graceful shutdown
  const shutdown = () => {
    console.log('\n[Shutdown] Stopping bot...');
    bot.stop();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[FATAL] Failed to start bot:', err);
  process.exit(1);
});
