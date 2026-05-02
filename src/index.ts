import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import express from 'express';

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log('[Config] Loaded .env from:', envPath);
}

import { createBot } from './bot';
import { startScheduler } from './services/scheduler';

const bot = createBot();
const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!WEBHOOK_URL) {
  throw new Error('WEBHOOK_URL no está definido en .env');
}

if (WEBHOOK_URL.includes('localhost')) {
  throw new Error('WEBHOOK_URL no puede ser localhost en producción');
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function setWebhookIfNeeded() {
  const info = await bot.telegram.getWebhookInfo();
  if (info.url === WEBHOOK_URL!) {
    console.log('[Webhook] Already set to:', WEBHOOK_URL);
    return;
  }
  try {
    await bot.telegram.setWebhook(WEBHOOK_URL!);
    console.log('[Webhook] Set successfully to:', WEBHOOK_URL);
  } catch (error: any) {
    const retryAfter = error?.response?.parameters?.retry_after;
    if (retryAfter) {
      console.log('[Webhook] Rate limited. Retrying after', retryAfter, 'seconds...');
      await sleep((retryAfter + 1) * 1000);
      await bot.telegram.setWebhook(WEBHOOK_URL!);
      console.log('[Webhook] Set successfully after retry:', WEBHOOK_URL);
      return;
    }
    throw error;
  }
}

const app = express();
app.use(express.json());
app.use(bot.webhookCallback('/api/webhook'));

app.get('/api/webhook', (req, res) => {
  res.json({ status: 'ok', bot: 'DespensaBot' });
});

app.listen(PORT, async () => {
  console.log('[Server] Listening on port', PORT);
  await setWebhookIfNeeded();
});

startScheduler(bot);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
