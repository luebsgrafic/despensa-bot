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

export async function showPantry(ctx: Context): Promise<void> {
  const buttons = STORAGE_ZONES.map((zone) => [
    Markup.button.callback(
      `${ZONE_EMOJIS[zone]} ${capitalize(zone)}`,
      `pantry_zone_${zone}`,
    ),
  ]);

  buttons.push([Markup.button.callback('❌ Cerrar', 'pantry_close')]);

  await ctx.reply('📦 ¿Qué zona quieres ver?', {
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function handlePantryZone(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const zone = ctx.callbackQuery.data.replace('pantry_zone_', '') as StorageZone;
  pantryState.set(ctx.chat!.id, { zone, page: 0 });
  await showZonePage(ctx, zone, 0);
}

export async function handlePantryPage(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;
  const chatId = ctx.chat!.id;
  const state = pantryState.get(chatId);
  if (!state) return;

  if (data === 'pantry_next') {
    state.page++;
    pantryState.set(chatId, state);
    await showZonePage(ctx, state.zone, state.page);
  } else if (data === 'pantry_prev') {
    state.page--;
    pantryState.set(chatId, state);
    await showZonePage(ctx, state.zone, state.page);
  }
}

async function showZonePage(ctx: Context, zone: StorageZone, page: number): Promise<void> {
  const allProducts = await productsRepo.getProductsByZone(zone);
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
      .map((p: any) => {
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
      depletedProducts.map((p: any) => p.name).join(', ');
  }

  text += `\n\n_Página ${currentPage + 1} de ${totalPages}_`;

  const navButtons: ReturnType<typeof Markup.button.callback>[] = [];
  if (currentPage > 0) {
    navButtons.push(Markup.button.callback('⬅️ Anterior', 'pantry_prev'));
  }
  if (currentPage < totalPages - 1) {
    navButtons.push(Markup.button.callback('Siguiente ➡️', 'pantry_next'));
  }

  const actionButtons = [
    Markup.button.callback('🔙 Volver a zonas', 'pantry_back'),
    Markup.button.callback('❌ Cerrar', 'pantry_close'),
  ];

  const keyboard = Markup.inlineKeyboard([
    ...(navButtons.length > 0 ? [navButtons] : []),
    actionButtons,
  ]);

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...keyboard,
  });
}

export async function handlePantryBack(ctx: Context): Promise<void> {
  const buttons = STORAGE_ZONES.map((zone) => [
    Markup.button.callback(
      `${ZONE_EMOJIS[zone]} ${capitalize(zone)}`,
      `pantry_zone_${zone}`,
    ),
  ]);
  buttons.push([Markup.button.callback('❌ Cerrar', 'pantry_close')]);

  await ctx.editMessageText('📦 ¿Qué zona quieres ver?', {
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function handlePantryClose(ctx: Context): Promise<void> {
  await ctx.deleteMessage().catch(() => {});
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
