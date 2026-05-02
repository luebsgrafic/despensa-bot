import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import http from 'http';

// Load .env FIRST, before any other imports
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log('[Config] Loaded .env from:', envPath);
} else {
  console.warn('[Config] No .env file found at:', envPath);
}

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
  // 1. Register webhook URL with Telegram (this is the ONLY setWebhook call)
  await setWebhookWithRetry(WEBHOOK_URL!);

  // 2. Create the webhook callback handler WITHOUT calling setWebhook again
  //    bot.createWebhook() returns a request handler, does NOT call setWebhook
  const webhookHandler = await bot.createWebhook({
    domain: 'localhost',
    path: '/api/webhook',
  });

  // 3. Create raw HTTP server (no express needed)
  const server = http.createServer((req, res) => {
    // Health check
    if (req.method === 'GET' && req.url === '/api/webhook') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', bot: 'DespensaBot' }));
      return;
    }

    // Webhook updates from Telegram
    if (req.method === 'POST' && req.url === '/api/webhook') {
      webhookHandler(req, res);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  // 4. Start listening
  server.listen(PORT, () => {
    console.log(`🤖 DespensaBot is running (webhook mode on port ${PORT})!`);
    console.log(`🔗 Webhook URL: ${WEBHOOK_URL}`);
  });

  // 5. Scheduler for daily alerts
  startScheduler(bot);

  // 6. Graceful shutdown
  const shutdown = () => {
    console.log('\n[Shutdown] Stopping bot...');
    server.close();
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
