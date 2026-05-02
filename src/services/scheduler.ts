import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { products as productsRepo } from '../db';
import { config } from '../utils/config';

export function startScheduler(bot: Telegraf): void {
  const cronExpression = `${config.alertMinute} ${config.alertHour} * * *`;

  cron.schedule(cronExpression, async () => {
    console.log(`[Scheduler] Running daily alert check at ${config.alertHour}:${config.alertMinute}`);

    try {
      const expiringProducts = await productsRepo.getExpiringProducts(
        config.expirationWarningDays,
      );

      if (expiringProducts.length === 0) {
        console.log('[Scheduler] No expiring products found.');
        return;
      }

      const message = buildExpirationMessage(expiringProducts);

      // Notify all authorized users
      for (const userId of config.allowedUsers) {
        try {
          await bot.telegram.sendMessage(userId, message, {
            parse_mode: 'Markdown',
          });
          console.log(`[Scheduler] Notification sent to user ${userId}`);
        } catch (error) {
          console.error(
            `[Scheduler] Failed to notify user ${userId}:`,
            error,
          );
        }
      }
    } catch (error) {
      console.error('[Scheduler] Error checking expiring products:', error);
    }
  });

  console.log(
    `[Scheduler] Daily alert scheduled for ${config.alertHour}:${config.alertMinute}`,
  );
}

function buildExpirationMessage(
  products: Awaited<ReturnType<typeof productsRepo.getExpiringProducts>>,
): string {
  const lines = products.map((p) => {
    const daysLeft = Math.ceil(
      (new Date(p.expiration_date!).getTime() - Date.now()) /
        (1000 * 60 * 60 * 24),
    );
    const urgency = daysLeft <= 1 ? '🔴' : '🟡';
    return `${urgency} *${p.name}* — caduca en ${daysLeft} día(s) (${p.expiration_date}) — ${p.quantity}${p.unit} en ${p.zone}`;
  });

  return (
    `⏰ *Alerta de caducidad*\n\n` +
    `Los siguientes productos están a punto de caducar:\n\n` +
    lines.join('\n') +
    `\n\n_Revisa la despensa y usa estos productos pronto._ 🧑‍🍳`
  );
}
