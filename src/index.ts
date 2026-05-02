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

const app = express();
app.use(express.json());
app.use(bot.webhookCallback('/api/webhook'));

app.get('/api/webhook', (_req, res) => {
  res.json({ status: 'ok', bot: 'DespensaBot' });
});

app.listen(PORT, () => {
  console.log(`🤖 DespensaBot running on port ${PORT}`);
  console.log('ℹ️  Webhook must be set manually via curl:');
  console.log('   curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://luesbgrafic.duckdns.org/api/webhook"');
});

startScheduler(bot);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
