import { Context, Markup } from 'telegraf';
import { products as productsRepo, shopping as shoppingRepo, movements } from '../db';
import { Product } from '../types';

// In-memory state for consume flow per chat
interface ConsumeState {
  productId: number;
  remainingQuantity: number;
}

const consumeState = new Map<number, ConsumeState>();

export async function startConsume(ctx: Context): Promise<void> {
  const text = (ctx.message as any)?.text;
  if (!text) return;

  // Extract product name from the message (remove emoji prefix if any)
  const query = text.replace(/^[➖\-]\s*/, '').trim();

  if (!query || query.length < 2) {
    await ctx.reply(
      '❌ Escribe qué producto gastaste (ej: "➖ leche" o "gasté 2 huevos")',
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
    await showConsumeProduct(ctx, results[0]);
    return;
  }

  // Multiple results — let user pick
  const buttons = results.slice(0, 10).map((p) => [
    Markup.button.callback(
      `${p.name} (${p.quantity}${p.unit} - ${p.zone})`,
      `consume_pick_${p.id}`,
    ),
  ]);
  buttons.push([Markup.button.callback('❌ Cancelar', 'consume_cancel')]);

  await ctx.reply('🔍 Varios productos coinciden. ¿Cuál gastaste?', {
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function handleConsumePick(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const productId = parseInt(
    ctx.callbackQuery.data.replace('consume_pick_', ''),
    10,
  );
  const product = await productsRepo.getProductById(productId);
  if (!product) {
    await ctx.editMessageText('❌ Producto no encontrado.');
    return;
  }
  await showConsumeProduct(ctx, product);
}

async function showConsumeProduct(ctx: Context, product: Product): Promise<void> {
  const expiryText = product.expiration_date
    ? ` (caduca: ${formatDate(product.expiration_date)})`
    : '';

  await ctx.editMessageText(
    `📦 *${product.name}*\n` +
      `Cantidad actual: *${product.quantity}${product.unit}*${expiryText}\n\n` +
      '¿Cuánto gastaste? (escribe el número)',
    { parse_mode: 'Markdown', reply_markup: { force_reply: true } },
  );

  consumeState.set(ctx.chat!.id, {
    productId: product.id,
    remainingQuantity: product.quantity,
  });
}

export async function handleConsumeAmount(ctx: Context): Promise<void> {
  const text = (ctx.message as any)?.text;
  if (!text) return;

  const chatId = ctx.chat!.id;
  const state = consumeState.get(chatId);
  if (!state) return;

  const amount = parseFloat(text.trim().replace(',', '.'));
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Escribe una cantidad válida (número positivo).', {
      reply_markup: { force_reply: true },
    });
    return;
  }

  const product = await productsRepo.getProductById(state.productId);
  if (!product) {
    await ctx.reply('❌ Producto no encontrado.');
    consumeState.delete(chatId);
    return;
  }

  const newQuantity = product.quantity - amount;

  if (newQuantity < 0) {
    // Asking to consume more than available
    const buttons = Markup.inlineKeyboard([
      Markup.button.callback(
        `✅ Sí, gastar ${amount}${product.unit} (quedará en 0)`,
        `consume_force_${amount}`,
      ),
      Markup.button.callback('❌ No, cancelar', 'consume_cancel'),
    ]);

    await ctx.reply(
      `⚠️ Solo tienes *${product.quantity}${product.unit}* de *${product.name}*.\n` +
        `¿Estás seguro de que quieres gastar *${amount}${product.unit}*? ` +
        `El producto quedará en 0.`,
      { parse_mode: 'Markdown', ...buttons },
    );
    return;
  }

  await executeConsume(ctx, product, amount, newQuantity);
}

export async function handleForceConsume(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const chatId = ctx.chat!.id;
  const state = consumeState.get(chatId);
  if (!state) return;

  const amount = parseFloat(ctx.callbackQuery.data.replace('consume_force_', ''));
  const product = await productsRepo.getProductById(state.productId);
  if (!product) {
    await ctx.editMessageText('❌ Producto no encontrado.');
    consumeState.delete(chatId);
    return;
  }

  await executeConsume(ctx, product, amount, 0);
}

async function executeConsume(
  ctx: Context,
  product: Product,
  amount: number,
  newQuantity: number,
): Promise<void> {
  const isDepleted = newQuantity <= 0;

  await productsRepo.updateProduct(product.id, {
    quantity: Math.max(0, newQuantity),
    is_depleted: isDepleted,
  });

  await movements.logMovement(
    product.id,
    isDepleted ? 'depleted' : 'consumed',
    `${product.quantity} ${product.unit}`,
    `${Math.max(0, newQuantity)} ${product.unit}`,
    ctx.from!.id,
  );

  const message =
    `✅ *${product.name}*: ${product.quantity}${product.unit} → ` +
    `${Math.max(0, newQuantity)}${product.unit}` +
    (isDepleted ? '\n\n⚠️ *Producto agotado*' : '');

  await ctx.editMessageText(message, { parse_mode: 'Markdown' });

  // Check if we should ask about shopping list
  const shouldAsk =
    isDepleted ||
    (product.min_stock !== null && newQuantity <= product.min_stock);

  if (shouldAsk) {
    const buttons = Markup.inlineKeyboard([
      Markup.button.callback('🛒 Sí, añadir a la lista', 'consume_add_shopping'),
      Markup.button.callback('✅ No, gracias', 'consume_done'),
    ]);

    await ctx.reply(
      isDepleted
        ? `🛒 *${product.name}* está agotado. ¿Lo añado a la lista de la compra?`
        : `🛒 *${product.name}* está por debajo del stock mínimo (${product.min_stock}${product.unit}). ¿Lo añado a la lista de la compra?`,
      { parse_mode: 'Markdown', ...buttons },
    );
  } else {
    consumeState.delete(ctx.chat!.id);
  }
}

export async function handleAddToShopping(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const chatId = ctx.chat!.id;
  const state = consumeState.get(chatId);
  if (!state) return;

  const product = await productsRepo.getProductById(state.productId);
  if (!product) {
    await ctx.editMessageText('❌ Producto no encontrado.');
    consumeState.delete(chatId);
    return;
  }

  await shoppingRepo.addShoppingItem({
    product_name: product.name,
    quantity: 1,
    unit: product.unit,
    added_by: ctx.from!.id,
  });

  await ctx.editMessageText(`🛒 *${product.name}* añadido a la lista de la compra.`, {
    parse_mode: 'Markdown',
  });
  consumeState.delete(chatId);
}

export function handleConsumeDone(ctx: Context): void {
  if (!ctx.callbackQuery) return;
  ctx.editMessageText('✅ De acuerdo, no lo añado a la lista.').catch(() => {});
  consumeState.delete(ctx.chat!.id);
}

export function handleConsumeCancel(ctx: Context): void {
  if (!ctx.callbackQuery) return;
  ctx.editMessageText('❌ Operación cancelada.').catch(() => {});
  consumeState.delete(ctx.chat!.id);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
  });
}
