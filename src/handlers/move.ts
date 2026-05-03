import { Context, Markup } from 'telegraf';
import { products as productsRepo, movements, zones as zonesRepo } from '../db';
import { MoveState } from '../types';

// In-memory state for move flow per chat
const moveState = new Map<number, MoveState>();

export async function startMove(ctx: Context): Promise<void> {
  const text = (ctx.message as any)?.text;
  if (!text) return;

  // Extract product name from "/mover nombre" or "mover nombre"
  const query = text
    .replace(/^\/mover\s*/i, '')
    .replace(/^mover\s*/i, '')
    .trim();

  if (!query || query.length < 2) {
    await ctx.reply(
      '❌ Escribe qué producto quieres mover (ej: "/mover leche" o "mover leche")',
    );
    return;
  }

  const results = await productsRepo.searchProducts(query);

  if (results.length === 0) {
    await ctx.reply(
      `❌ No encontré "${query}" en la despensa.\n` +
        'Prueba con otro nombre o añádelo primero con ➕ Añadir.',
    );
    return;
  }

  if (results.length === 1) {
    await showZonePicker(ctx, results[0].id, results[0].name, results[0].zone_id);
    return;
  }

  // Multiple results — let user pick
  const buttons = results.slice(0, 10).map((p) => [
    Markup.button.callback(
      `${p.name} (${p.quantity}${p.unit})`,
      `move_pick_${p.id}`,
    ),
  ]);
  buttons.push([Markup.button.callback('❌ Cancelar', 'move_cancel')]);

  await ctx.reply('🔍 Varios productos coinciden. ¿Cuál quieres mover?', {
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function handleMovePickProduct(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const productId = parseInt(
    ctx.callbackQuery.data.replace('move_pick_', ''),
    10,
  );
  const product = await productsRepo.getProductById(productId);
  if (!product) {
    await ctx.editMessageText('❌ Producto no encontrado.');
    return;
  }

  await showZonePicker(ctx, product.id, product.name, product.zone_id);
}

/**
 * Start move flow for a specific product (bypasses product search).
 * Used by pantry.ts when user clicks "Mover" button on a product.
 */
export async function startMoveForProduct(
  ctx: Context,
  productId: number,
  productName: string,
  currentZoneId: number | null,
): Promise<void> {
  await showZonePicker(ctx, productId, productName, currentZoneId);
}

async function showZonePicker(
  ctx: Context,
  productId: number,
  productName: string,
  currentZoneId: number | null,
): Promise<void> {
  const userId = ctx.from!.id;
  const zones = await zonesRepo.getZonesByUser(userId);

  // Filter out the current zone
  const availableZones = zones.filter((z) => z.id !== currentZoneId);

  if (availableZones.length === 0) {
    await ctx.reply('❌ No hay otras zonas disponibles para mover el producto.');
    return;
  }

  // Save state
  moveState.set(ctx.chat!.id, {
    productId,
    productName,
    currentZoneId,
  });

  const buttons = availableZones.map((z) => [
    Markup.button.callback(
      `${z.emoji} ${capitalize(z.name)}`,
      `move_zone_${z.id}`,
    ),
  ]);
  buttons.push([Markup.button.callback('❌ Cancelar', 'move_cancel')]);

  await ctx.reply(
    `📦 ¿A qué zona quieres mover *${productName}*?`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    },
  );
}

export async function handleMovePickZone(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const chatId = ctx.chat!.id;
  const state = moveState.get(chatId);
  if (!state) return;

  const zoneId = parseInt(
    ctx.callbackQuery.data.replace('move_zone_', ''),
    10,
  );
  const zone = await zonesRepo.getZoneById(zoneId);
  if (!zone) {
    await ctx.editMessageText('❌ Zona no encontrada.');
    return;
  }

  const buttons = Markup.inlineKeyboard([
    Markup.button.callback(
      `✅ Mover a ${zone.emoji} ${capitalize(zone.name)}`,
      `move_confirm_${zoneId}`,
    ),
    Markup.button.callback('❌ Cancelar', 'move_cancel'),
  ]);

  await ctx.editMessageText(
    `📦 *${state.productName}* → ${zone.emoji} *${capitalize(zone.name)}*\n\n` +
      '¿Confirmas el movimiento?',
    {
      parse_mode: 'Markdown',
      ...buttons,
    },
  );
}

export async function executeMove(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const chatId = ctx.chat!.id;
  const state = moveState.get(chatId);
  if (!state) {
    console.warn(`[Move] No state found for chat ${chatId}`);
    return;
  }

  const rawData = ctx.callbackQuery.data;
  console.log(`[Move] executeMove called with data: "${rawData}"`);

  const zoneId = parseInt(rawData.replace('move_confirm_', ''), 10);
  console.log(`[Move] Parsed zoneId: ${zoneId} (isNaN: ${isNaN(zoneId)})`);

  if (isNaN(zoneId)) {
    await ctx.editMessageText('❌ Error: zona no válida.');
    moveState.delete(chatId);
    return;
  }

  const zone = await zonesRepo.getZoneById(zoneId);
  if (!zone) {
    console.warn(`[Move] Zone ${zoneId} not found in DB`);
    await ctx.editMessageText('❌ Zona no encontrada.');
    moveState.delete(chatId);
    return;
  }

  const product = await productsRepo.getProductById(state.productId);
  if (!product) {
    console.warn(`[Move] Product ${state.productId} not found in DB`);
    await ctx.editMessageText('❌ Producto no encontrado.');
    moveState.delete(chatId);
    return;
  }

  console.log(`[Move] Product before update: id=${product.id}, zone_id=${product.zone_id}, zone="${product.zone}"`);

  // Update product zone
  const updated = await productsRepo.updateProduct(state.productId, { zone_id: zoneId });
  console.log(`[Move] updateProduct result:`, updated ? `id=${updated.id}, zone_id=${updated.zone_id}, zone="${updated.zone}"` : 'undefined (product not found)');

  if (!updated) {
    await ctx.editMessageText('❌ Error al actualizar el producto.');
    moveState.delete(chatId);
    return;
  }

  // Get old zone name for the log
  const oldZone = product.zone_id
    ? await zonesRepo.getZoneById(product.zone_id)
    : null;

  // Log movement
  await movements.logMovement(
    state.productId,
    'moved',
    oldZone ? `${oldZone.emoji} ${oldZone.name}` : 'desconocida',
    `${zone.emoji} ${zone.name}`,
    ctx.from!.id,
  );

  await ctx.editMessageText(
    `✅ *${state.productName}* movido a ${zone.emoji} *${capitalize(zone.name)}*.`,
    { parse_mode: 'Markdown' },
  );

  moveState.delete(chatId);
}

export function handleMoveCancel(ctx: Context): void {
  if (!ctx.callbackQuery) return;
  ctx.editMessageText('❌ Movimiento cancelado.').catch(() => {});
  moveState.delete(ctx.chat!.id);
}

function capitalize(str: string): string {
  return str
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
