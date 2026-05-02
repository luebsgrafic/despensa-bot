import { createBot } from './bot';
import { startScheduler } from './services/scheduler';

const bot = createBot();

// Scheduler solo funciona en long polling (desarrollo local)
startScheduler(bot);

bot.launch().then(() => {
  console.log('🤖 DespensaBot is running (long polling)!');
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
