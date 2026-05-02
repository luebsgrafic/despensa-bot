import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Telegraf } from 'telegraf';
import { products as productsRepo } from '../../src/db';
import { config } from '../../src/utils/config';

// Vercel Cron Job: runs daily at 9:00 AM
// Checks for expiring products and notifies all users

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers['x-vercel-cron'] !== '1') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  console.log('[Cron] Running expiration check');

  try {
    const expiringProducts = await productsRepo.getExpiringProducts(
      config.expirationWarningDays,
    );

    if (expiringProducts.length === 0) {
      console.log('[Cron] No expiring products found.');
      res.status(200).json({ notified: 0, message: 'No expiring products' });
      return;
    }

    const message = buildExpirationMessage(expiringProducts);
    const bot = new Telegraf(config.telegramBotToken);

    let notifiedCount = 0;
    for (const userId of config.allowedUsers) {
      try {
        await bot.telegram.sendMessage(userId, message, {
          parse_mode: 'Markdown',
        });
        notifiedCount++;
      } catch (error) {
        console.error(`[Cron] Failed to notify user ${userId}:`, error);
      }
    }

    console.log(`[Cron] Notified ${notifiedCount} users about ${expiringProducts.length} products`);
    res.status(200).json({ notified: notifiedCount, products: expiringProducts.length });
  } catch (error) {
    console.error('[Cron] Error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
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
