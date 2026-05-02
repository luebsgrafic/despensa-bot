import { Context, Markup } from 'telegraf';
import { products as productsRepo } from '../db';
import { STORAGE_ZONES, ZONE_EMOJIS, StorageZone } from '../types';

const ITEMS_PER_PAGE = 8;

interface PantryState {
  zone: StorageZone;
  page: number;
}

// In-memory pagination state per chat
const pantryState = new Map<number, PantryState>();

export function showPantry(ctx: Context): void {
  // Show zone selection first
  const buttons = STORAGE_ZONES.map((zone) => [
    Markup.button.callback(
      `${ZONE_EMOJIS[zone]} ${capitalize(zone)}`,
      `pantry_zone_${zone}`,
    ),
  ]);

  buttons.push([Markup.button.callback('❌ Cerrar', 'pantry_close')]);

  ctx.reply('📦 ¿Qué zona quieres ver?', {
    reply_markup: { inline_keyboard: buttons },
  });
}

export function handlePantryZone(ctx: Context & { match?: RegExpExecArray }): void {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const zone = ctx.callbackQuery.data.replace('pantry_zone_', '') as StorageZone;
  pantryState.set(ctx.chat!.id, { zone, page: 0 });
  showZonePage(ctx, zone, 0);
}

export function handlePantryPage(ctx: Context & { match?: RegExpExecArray }): void {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const chatId = ctx.chat!.id;
  const state = pantryState.get(chatId);
  if (!state) return;

  if (data === 'pantry_next') {
    state.page++;
    pantryState.set(chatId, state);
    showZonePage(ctx, state.zone, state.page);
  } else if (data === 'pantry_prev') {
    state.page--;
    pantryState.set(chatId, state);
    showZonePage(ctx, state.zone, state.page);
  }
}

function showZonePage(ctx: Context, zone: StorageZone, page: number): void {
  const allProducts = productsRepo.getProductsByZone(zone);
  const activeProducts = allProducts.filter((p) => !p.is_depleted);
  const depletedProducts = allProducts.filter((p) => p.is_depleted);

  const totalPages = Math.max(
    1,
    Math.ceil(activeProducts.length / ITEMS_PER_PAGE),
  );
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * ITEMS_PER_PAGE;
  const pageItems = activeProducts.slice(start, start + ITEMS_PER_PAGE);

  const emoji = ZONE_EMOJIS[zone];
  let text = `${emoji} *${capitalize(zone)}*\n\n`;

  if (pageItems.length === 0) {
    text += '_No hay productos en esta zona._';
  } else {
    text += pageItems
      .map((p) => {
        const expiry = p.expiration_date
          ? ` (caduca: ${formatDate(p.expiration_date)})`
          : '';
        const minStock =
          p.min_stock !== null ? ` / mín: ${p.min_stock}${p.unit}` : '';
        return `• ${p.name}: ${p.quantity}${p.unit}${minStock}${expiry}`;
      })
      .join('\n');
  }

  if (depletedProducts.length > 0) {
    text +=
      `\n\n_Agotados:_ ` +
      depletedProducts.map((p) => p.name).join(', ');
  }

  text += `\n\n_Página ${currentPage + 1} de ${totalPages}_`;

  const buttons = Markup.inlineKeyboard([
    ...(currentPage > 0
      ? [Markup.button.callback('⬅️ Anterior', 'pantry_prev')]
      : []),
    ...(currentPage < totalPages - 1
      ? [Markup.button.callback('Siguiente ➡️', 'pantry_next')]
      : []),
    [Markup.button.callback('🔙 Volver a zonas', 'pantry_back')],
    [Markup.button.callback('❌ Cerrar', 'pantry_close')],
  ]);

  ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...buttons,
  });
}

export function handlePantryBack(ctx: Context): void {
  const buttons = STORAGE_ZONES.map((zone) => [
    Markup.button.callback(
      `${ZONE_EMOJIS[zone]} ${capitalize(zone)}`,
      `pantry_zone_${zone}`,
    ),
  ]);
  buttons.push([Markup.button.callback('❌ Cerrar', 'pantry_close')]);

  ctx.editMessageText('📦 ¿Qué zona quieres ver?', {
    reply_markup: { inline_keyboard: buttons },
  });
}

export function handlePantryClose(ctx: Context): void {
  ctx.deleteMessage().catch(() => {});
  pantryState.delete(ctx.chat!.id);
}

function capitalize(str: string): string {
  return str
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
  });
}
