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

async function setWebhookWithRetry(url: string, maxRetries = 5): Promise<void> {
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
  // 1. Register webhook URL with Telegram (only setWebhook call)
  await setWebhookWithRetry(WEBHOOK_URL!);

  // 2. Express server — NO bot.launch(), NO bot.createWebhook()
  const app = express();

  // Health check
  app.get('/api/webhook', (_req, res) => {
    res.json({ status: 'ok', bot: 'DespensaBot' });
  });

  // Webhook endpoint — raw body required by Telegraf
  app.post('/api/webhook', express.text({ type: '*/*' }), async (req, res) => {
    try {
      const update = JSON.parse(req.body);
      await bot.handleUpdate(update);
      res.json({ ok: true });
    } catch (error: any) {
      console.error('[Webhook] Error processing update:', error?.message);
      res.json({ ok: true }); // Always 200 to Telegram
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
