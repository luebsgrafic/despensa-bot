import { Context, Markup } from 'telegraf';
import { shopping as shoppingRepo, products as productsRepo, movements, zones as zonesRepo } from '../db';
import { ProductUnit } from '../types';

const ITEMS_PER_PAGE = 10;

interface ShoppingPageState {
  page: number;
}

interface BuyWizardState {
  shoppingItemId: number;
  productName: string;
  quantity: number;
  unit: string;
  zoneId: number | null;
  zoneName: string | null;
  step: 'qty' | 'qty_awaiting' | 'zone' | 'confirm';
}

const pageState = new Map<number, ShoppingPageState>();
const buyWizardState = new Map<number, BuyWizardState>();

export function getBuyWizardState(chatId: number): BuyWizardState | undefined {
  return buyWizardState.get(chatId);
}

export function clearBuyWizardState(chatId: number): void {
  buyWizardState.delete(chatId);
}

export async function showShoppingList(ctx: Context): Promise<void> {
  const items = await shoppingRepo.getAllShoppingItems();
  const unchecked = items.filter((i) => !i.is_checked);
  const checked = items.filter((i) => i.is_checked);

  if (items.length === 0) {
    await ctx.reply('🛒 *Lista de la compra*\n\n_La lista está vacía._', {
      parse_mode: 'Markdown',
    });
    return;
  }

  const chatId = ctx.chat!.id;
  pageState.set(chatId, { page: 0 });
  await renderShoppingPage(ctx, chatId, items, 0);
}

async function renderShoppingPage(
  ctx: Context,
  chatId: number,
  allItems: Awaited<ReturnType<typeof shoppingRepo.getAllShoppingItems>>,
  page: number,
): Promise<void> {
  const unchecked = allItems.filter((i) => !i.is_checked);
  const checked = allItems.filter((i) => i.is_checked);

  const totalPages = Math.max(1, Math.ceil(allItems.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * ITEMS_PER_PAGE;
  const pageItems = allItems.slice(start, start + ITEMS_PER_PAGE);

  let text = '🛒 *Lista de la compra*\n\n';

  if (pageItems.length === 0) {
    text += '_No hay productos en esta página._';
  } else {
    text += pageItems
      .map((item) => {
        const status = item.is_checked ? '✅' : '⬜';
        return `${status} ${item.product_name}: ${item.quantity}${item.unit}`;
      })
      .join('\n');
  }

  if (checked.length > 0) {
    text += `\n\n_Tachados: ${checked.length} de ${allItems.length}_`;
  }

  text += `\n\n_Página ${currentPage + 1} de ${totalPages}_`;

  const buttons: ReturnType<typeof Markup.button.callback>[][] = [];

  for (const item of pageItems) {
    if (!item.is_checked) {
      buttons.push([
        Markup.button.callback(
          `✅ Comprar ${item.product_name}`,
          `shop_buy_${item.id}`,
        ),
      ]);
    }
  }

  const navButtons: ReturnType<typeof Markup.button.callback>[] = [];
  if (currentPage > 0) {
    navButtons.push(Markup.button.callback('⬅️', 'shop_prev'));
  }
  if (currentPage < totalPages - 1) {
    navButtons.push(Markup.button.callback('➡️', 'shop_next'));
  }
  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }

  buttons.push([
    Markup.button.callback('📤 Compartir lista', 'shop_share'),
    Markup.button.callback('🗑️ Limpiar tachados', 'shop_clear'),
  ]);
  buttons.push([Markup.button.callback('❌ Cerrar', 'shop_close')]);

  if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  } else {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }
}

// ── Buy Wizard ──────────────────────────────────────────────

export async function handleBuyItem(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const itemId = parseInt(ctx.callbackQuery.data.replace(/^shop_(buy|toggle)_/, ''), 10);

  const items = await shoppingRepo.getAllShoppingItems();
  const item = items.find((i) => i.id === itemId);
  if (!item) {
    await ctx.answerCbQuery('❌ Producto no encontrado en la lista');
    return;
  }

  const chatId = ctx.chat!.id;
  buyWizardState.set(chatId, {
    shoppingItemId: item.id,
    productName: item.product_name,
    quantity: 1,
    unit: item.unit,
    zoneId: null,
    zoneName: null,
    step: 'qty',
  });

  await ctx.answerCbQuery();
  await showBuyQtyStep(ctx, item.product_name, item.unit);
}

async function showBuyQtyStep(ctx: Context, productName: string, unit: string): Promise<void> {
  const buttons = [
    [
      Markup.button.callback('1', 'shop_qty_1'),
      Markup.button.callback('2', 'shop_qty_2'),
      Markup.button.callback('3', 'shop_qty_3'),
    ],
    [
      Markup.button.callback('5', 'shop_qty_5'),
      Markup.button.callback('10', 'shop_qty_10'),
      Markup.button.callback('✏️ Otro', 'shop_qty_custom'),
    ],
    [Markup.button.callback('❌ Cancelar', 'shop_buy_cancel')],
  ];

  await ctx.reply(
    `🛒 ¿Cuántos *${productName}* compraste?`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } },
  );
}

export async function handleBuyQty(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const chatId = ctx.chat!.id;
  const state = buyWizardState.get(chatId);
  if (!state) return;

  const qty = parseInt(ctx.callbackQuery.data.replace('shop_qty_', ''), 10);
  state.quantity = qty;
  state.step = 'zone';
  await ctx.answerCbQuery();
  await showBuyZoneStep(ctx);
}

export async function handleBuyQtyCustom(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const chatId = ctx.chat!.id;
  const state = buyWizardState.get(chatId);
  if (!state) return;

  state.step = 'qty_awaiting';
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `✏️ ¿Cuántos *${state.productName}* compraste? Escribe el número.`,
    { parse_mode: 'Markdown' },
  );
}

export async function handleBuyCustomQtyInput(ctx: Context): Promise<void> {
  const text = (ctx.message as any)?.text;
  if (!text) return;

  const chatId = ctx.chat!.id;
  const state = buyWizardState.get(chatId);
  if (!state || state.step !== 'qty_awaiting') return;

  const qty = parseFloat(text.trim().replace(',', '.'));
  if (isNaN(qty) || qty <= 0) {
    await ctx.reply('❌ Escribe una cantidad válida (número positivo).');
    return;
  }

  state.quantity = qty;
  state.step = 'zone';
  await showBuyZoneStep(ctx);
}

async function showBuyZoneStep(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  const state = buyWizardState.get(chatId);
  if (!state) return;

  const userId = ctx.from?.id || 0;
  const zones = await zonesRepo.getZonesByUser(userId);

  if (zones.length === 0) {
    await ctx.reply('❌ No hay zonas disponibles. Crea una zona primero.');
    buyWizardState.delete(chatId);
    return;
  }

  const buttons = zones.map((z) => [
    Markup.button.callback(
      `${z.emoji || '📦'} ${z.name}`,
      `shop_dest_${z.id}`,
    ),
  ]);
  buttons.push([Markup.button.callback('❌ Cancelar', 'shop_buy_cancel')]);

  if (ctx.callbackQuery && 'message' in ctx.callbackQuery) {
    await ctx.editMessageText(
      `📦 ¿En qué zona guardas *${state.productName}*?`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } },
    );
  } else {
    await ctx.reply(
      `📦 ¿En qué zona guardas *${state.productName}*?`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } },
    );
  }
}

export async function handleBuyZone(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const chatId = ctx.chat!.id;
  const state = buyWizardState.get(chatId);
  if (!state) return;

  const zoneId = parseInt(ctx.callbackQuery.data.replace('shop_dest_', ''), 10);

  const zone = (await zonesRepo.getZonesByUser(ctx.from?.id || 0)).find((z) => z.id === zoneId);
  if (!zone) {
    await ctx.answerCbQuery('❌ Zona no encontrada');
    return;
  }

  state.zoneId = zoneId;
  state.zoneName = zone.name;
  state.step = 'confirm';

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `✅ *${state.productName}*: ${state.quantity}${state.unit} → *${state.zoneName}*\n\n¿Guardar?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('✅ Sí, guardar', 'shop_confirm')],
          [Markup.button.callback('❌ Cancelar', 'shop_buy_cancel')],
        ],
      },
    },
  );
}

export async function handleBuyConfirm(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const chatId = ctx.chat!.id;
  const state = buyWizardState.get(chatId);
  if (!state) return;

  const userId = ctx.from?.id || 0;

  try {
    const product = await productsRepo.createProduct({
      name: state.productName,
      quantity: state.quantity,
      unit: state.unit as ProductUnit,
      zone: state.zoneName as any,
      zone_id: state.zoneId!,
    });

    await shoppingRepo.removeShoppingItem(state.shoppingItemId);

    await movements.logMovement(
      product.id,
      'restocked',
      null,
      `${state.quantity} ${state.unit} en ${state.zoneName}`,
      userId,
    );

    await ctx.editMessageText(
      `✅ *${state.productName}*: ${state.quantity}${state.unit} → *${state.zoneName}*\n\n` +
      `Producto añadido a la despensa y eliminado de la lista de compra.`,
      { parse_mode: 'Markdown' },
    );
  } catch (error) {
    console.error('Error buying item:', error);
    await ctx.editMessageText('❌ Error al guardar el producto. Intenta de nuevo.');
  }

  buyWizardState.delete(chatId);
}

export async function handleBuyCancel(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const chatId = ctx.chat!.id;
  buyWizardState.delete(chatId);

  await ctx.answerCbQuery();
  await ctx.editMessageText('❌ Operación cancelada.');
}

// ── Shopping page navigation ────────────────────────────────

export async function handleShoppingPage(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const chatId = ctx.chat!.id;
  const state = pageState.get(chatId) || { page: 0 };
  const data = ctx.callbackQuery.data;

  if (data === 'shop_next') state.page++;
  else if (data === 'shop_prev') state.page--;

  pageState.set(chatId, state);
  await refreshShoppingList(ctx);
}

export async function handleShareList(ctx: Context): Promise<void> {
  const items = await shoppingRepo.getUncheckedItems();

  if (items.length === 0) {
    await ctx.editMessageText('🛒 *Lista de la compra*\n\n_No hay nada pendiente._', {
      parse_mode: 'Markdown',
    });
    return;
  }

  const text =
    '🛒 *Lista de la compra*\n\n' +
    items
      .map((item, i) => `${i + 1}. ${item.product_name}: ${item.quantity}${item.unit}`)
      .join('\n');

  await ctx.reply(text, { parse_mode: 'Markdown' });
  await ctx.answerCbQuery('✅ Lista compartida');
}

export async function handleClearChecked(ctx: Context): Promise<void> {
  const count = await shoppingRepo.clearCheckedItems();
  await ctx.editMessageText(
    `🗑️ Se eliminaron ${count} producto(s) tachado(s) de la lista.`,
  );
  pageState.delete(ctx.chat!.id);
}

export async function handleShoppingClose(ctx: Context): Promise<void> {
  await ctx.deleteMessage().catch(() => {});
  pageState.delete(ctx.chat!.id);
}

async function refreshShoppingList(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  const state = pageState.get(chatId) || { page: 0 };
  const items = await shoppingRepo.getAllShoppingItems();
  await renderShoppingPage(ctx, chatId, items, state.page);
}
