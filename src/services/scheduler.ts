import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { products as productsRepo, movements as movementsRepo } from '../db';
import { config } from '../utils/config';

// In-memory set of chat IDs that have interacted with the bot
// In a production app this should be persisted
const activeChats = new Set<number>();

export function registerChat(chatId: number): void {
  activeChats.add(chatId);
}

// ── Daily expiration alerts ──────────────────────────────

export function startScheduler(bot: Telegraf): void {
  const cronExpression = `${config.alertMinute} ${config.alertHour} * * *`;

  cron.schedule(
    cronExpression,
    async () => {
      console.log(`[Scheduler] Running daily expiration check`);

      try {
        const expiringProducts = await productsRepo.getExpiringProducts(7);

        if (expiringProducts.length === 0) {
          console.log('[Scheduler] No expiring products found.');
          return;
        }

        const message = buildExpirationMessage(expiringProducts);

        for (const chatId of activeChats) {
          try {
            await bot.telegram.sendMessage(chatId, message, {
              parse_mode: 'Markdown',
            });
            console.log(`[Scheduler] Notification sent to chat ${chatId}`);
          } catch (error) {
            console.error(`[Scheduler] Failed to notify chat ${chatId}:`, error);
          }
        }
      } catch (error) {
        console.error('[Scheduler] Error checking expiring products:', error);
      }
    },
    { timezone: 'Europe/Madrid' },
  );

  console.log(
    `[Scheduler] Daily alert scheduled for ${config.alertHour}:${config.alertMinute} Europe/Madrid`,
  );
}

export function buildExpirationMessage(
  products: Awaited<ReturnType<typeof productsRepo.getExpiringProducts>>,
): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const red: string[] = [];
  const orange: string[] = [];
  const yellow: string[] = [];

  for (const p of products) {
    const expDate = new Date(p.expiration_date! + 'T00:00:00');
    const diffTime = expDate.getTime() - today.getTime();
    const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const line = `*${p.name}* — ${daysLeft} día(s) (${p.expiration_date}) — ${p.quantity}${p.unit}`;

    if (daysLeft <= 0) {
      red.push(`🔴 ${line}`);
    } else if (daysLeft <= 3) {
      orange.push(`🟠 ${line}`);
    } else {
      yellow.push(`🟡 ${line}`);
    }
  }

  const parts: string[] = [];
  if (red.length > 0) parts.push(...red);
  if (orange.length > 0) parts.push(...orange);
  if (yellow.length > 0) parts.push(...yellow);

  if (parts.length === 0) return '';

  return (
    `⏰ *Alerta de caducidad*\n\n` +
    `Los siguientes productos están a punto de caducar:\n\n` +
    parts.join('\n') +
    `\n\n_Revisa la despensa y usa estos productos pronto._ 🧑‍🍳`
  );
}

// ── Weekly summary ───────────────────────────────────────

export function startWeeklySummary(bot: Telegraf): void {
  // Every Monday at 09:00 Europe/Madrid
  cron.schedule(
    '0 9 * * 1',
    async () => {
      console.log('[Scheduler] Running weekly summary');

      try {
        const message = await buildWeeklySummary();
        if (!message) {
          console.log('[Scheduler] No weekly summary data.');
          return;
        }

        for (const chatId of activeChats) {
          try {
            await bot.telegram.sendMessage(chatId, message, {
              parse_mode: 'Markdown',
            });
            console.log(`[Scheduler] Weekly summary sent to chat ${chatId}`);
          } catch (error) {
            console.error(
              `[Scheduler] Failed to send weekly summary to chat ${chatId}:`,
              error,
            );
          }
        }
      } catch (error) {
        console.error('[Scheduler] Error building weekly summary:', error);
      }
    },
    { timezone: 'Europe/Madrid' },
  );

  console.log('[Scheduler] Weekly summary scheduled for Monday 09:00 Europe/Madrid');
}

export async function buildWeeklySummary(): Promise<string> {
  const [topConsumed, lowStock, expired] = await Promise.all([
    movementsRepo.getTopConsumed(7, 3),
    productsRepo.getLowStockProducts(),
    productsRepo.getExpiredProducts(),
  ]);

  const parts: string[] = ['📊 *Resumen semanal de la despensa*\n'];

  if (topConsumed.length > 0) {
    parts.push('*Top 3 productos más consumidos:*');
    topConsumed.forEach((p, i) => {
      parts.push(`${i + 1}. ${p.product_name} (${p.count} vez/veces)`);
    });
    parts.push('');
  }

  const lowStockTop = lowStock.slice(0, 3);
  if (lowStockTop.length > 0) {
    parts.push('*Productos con stock bajo:*');
    lowStockTop.forEach((p) => {
      parts.push(
        `⚠️ ${p.name} — ${p.quantity}${p.unit} (mín: ${p.min_stock}${p.unit})`,
      );
    });
    parts.push('');
  }

  if (expired.length > 0) {
    parts.push('*Productos caducados sin consumir:*');
    expired.forEach((p) => {
      parts.push(`❌ ${p.name} — caducó el ${p.expiration_date}`);
    });
    parts.push('');
  }

  if (parts.length === 1) {
    return '';
  }

  parts.push('_Revisa tu despensa y planifica las compras._ 🛒');

  return parts.join('\n');
}
