import { Context, Markup } from 'telegraf';
import { shopping as shoppingRepo } from '../db';
import { ProductUnit } from '../types';

const ITEMS_PER_PAGE = 10;

interface ShoppingPageState {
  page: number;
}

const pageState = new Map<number, ShoppingPageState>();

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

  // Add toggle buttons for items on this page
  for (const item of pageItems) {
    buttons.push([
      Markup.button.callback(
        item.is_checked ? `↩️ ${item.product_name}` : `✅ ${item.product_name}`,
        `shop_toggle_${item.id}`,
      ),
    ]);
  }

  // Pagination
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

  // Action buttons
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

export async function handleToggleItem(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const itemId = parseInt(ctx.callbackQuery.data.replace('shop_toggle_', ''), 10);
  await shoppingRepo.toggleShoppingItem(itemId);
  await refreshShoppingList(ctx);
}

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
