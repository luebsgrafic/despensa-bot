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

console.log('[Config] PORT:', PORT);

async function main() {
  // Express server — NO bot.launch(), NO bot.createWebhook(), NO setWebhook
  const app = express();

  // Health check for nginx
  app.get('/api/webhook', (_req, res) => {
    res.status(200).json({ status: 'ok', bot: 'DespensaBot' });
  });

  // Webhook endpoint — raw Buffer body, passed directly to bot.handleUpdate()
  // setWebhook is NOT called here — it must be configured manually via curl:
  // curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<domain>/api/webhook"
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

  // Start listening
  const server = app.listen(PORT, () => {
    console.log(`🤖 DespensaBot is running (webhook mode on port ${PORT})!`);
    console.log(`ℹ️  Webhook must be set manually via curl to Telegram API`);
  });

  // Scheduler for daily alerts
  startScheduler(bot);

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Shutdown] Stopping bot...');
    bot.stop();
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[FATAL] Failed to start bot:', err);
  process.exit(1);
});
