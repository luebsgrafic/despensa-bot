import { createBot } from './bot';
import { startScheduler } from './services/scheduler';
import { config } from './utils/config';

const bot = createBot();

// Scheduler solo funciona en long polling (desarrollo local)
startScheduler(bot);

bot.launch().then(() => {
  console.log('🤖 DespensaBot is running (long polling)!');
  console.log(`👥 Allowed users: ${config.allowedUsers.join(', ')}`);
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
