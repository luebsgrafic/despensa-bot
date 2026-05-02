import { createBot } from './bot';
import { startScheduler } from './services/scheduler';
import { config } from './utils/config';

const bot = createBot();

const PORT = parseInt(process.env.PORT || '3000', 10);
const WEBHOOK_URL = process.env.WEBHOOK_URL || `https://luebsgrafic.duckdns.org/api/webhook`;

async function main() {
  // Set webhook on Telegram
  await bot.telegram.setWebhook(WEBHOOK_URL);
  console.log(`[Webhook] Set to: ${WEBHOOK_URL}`);

  // Start webhook server (no polling)
  await bot.launch({
    webhook: {
      domain: 'localhost', // nginx proxies to localhost:PORT
      port: PORT,
      path: '/api/webhook',
    },
  });

  console.log(`🤖 DespensaBot is running (webhook mode on port ${PORT})!`);

  // Scheduler for daily alerts
  startScheduler(bot);
}

main().catch((err) => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
