import { Context } from 'telegraf';
import { movements, products } from '../db';

const ACTION_EMOJIS: Record<string, string> = {
  added: '➕',
  consumed: '➖',
  moved: '📦',
  restocked: '📥',
  depleted: '⚠️',
};

function formatDate(isoStr: string): string {
  const d = new Date(isoStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month} ${hours}:${minutes}`;
}

function formatMovementLine(
  m: { action: string; previous_value: string | null; new_value: string | null; created_at: string },
  productName: string,
): string {
  const emoji = ACTION_EMOJIS[m.action] || '❓';
  const dateStr = formatDate(m.created_at);

  let detail: string;
  switch (m.action) {
    case 'added':
      detail = m.new_value || 'añadido';
      break;
    case 'consumed':
      detail = `${m.previous_value} → ${m.new_value}`;
      break;
    case 'moved':
      detail = `${m.previous_value} → ${m.new_value}`;
      break;
    case 'restocked':
      detail = `+${m.new_value} (de la compra)`;
      break;
    case 'depleted':
      detail = 'agotado';
      break;
    default:
      detail = m.action;
  }

  return `${emoji} ${dateStr} — ${productName}: ${detail}`;
}

export async function showHistory(ctx: Context): Promise<void> {
  const text = (ctx.message as any)?.text || '';
  const args = text.replace(/^\/historial\s*/, '').trim();

  if (args) {
    const results = await products.searchProducts(args);
    if (results.length === 0) {
      await ctx.reply(`❌ No encontré "${args}" en la despensa.`);
      return;
    }

    const product = results[0];
    const logs = await movements.getMovementsByProduct(product.id, 10);

    if (logs.length === 0) {
      await ctx.reply(`📋 No hay movimientos registrados para *${product.name}*.`, {
        parse_mode: 'Markdown',
      });
      return;
    }

    const lines = logs.map((m) => formatMovementLine(m, product.name));
    await ctx.reply(`📋 *Historial de ${product.name}*\n\n${lines.join('\n')}`, {
      parse_mode: 'Markdown',
    });
    return;
  }

  const logs = await movements.getRecentMovements(10);

  if (logs.length === 0) {
    await ctx.reply('📋 No hay movimientos registrados.');
    return;
  }

  const allProducts = await products.getAllProducts();
  const productNames = new Map<number, string>();
  for (const p of allProducts) {
    productNames.set(p.id, p.name);
  }

  const lines = logs.map((m) => {
    const name = productNames.get(m.product_id) || `#${m.product_id}`;
    return formatMovementLine(m, name);
  });

  await ctx.reply(`📋 *Historial reciente*\n\n${lines.join('\n')}`, {
    parse_mode: 'Markdown',
  });
}
