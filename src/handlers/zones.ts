import { Context, Markup } from 'telegraf';
import { zones as zonesRepo } from '../db';
import { Zone } from '../types';

const ZONE_WIZARD_TIMEOUT = 30000;

// In-memory wizard state per chat
const zoneWizardState = new Map<number, { step: string; zoneId?: number }>();

function capitalize(str: string): string {
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function isSystemZone(zone: Zone): boolean {
  return zone.user_id === null;
}

export async function showZones(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const zones = await zonesRepo.getZonesByUser(userId);

  const systemZones = zones.filter(isSystemZone);
  const userZones = zones.filter((z) => !isSystemZone(z));

  let text = '📦 *Tus zonas:*\n\n';

  for (const z of systemZones) {
    text += `${z.emoji} ${capitalize(z.name)} *(sistema)*\n`;
  }

  if (userZones.length > 0) {
    text += '\n';
    for (const z of userZones) {
      text += `${z.emoji} ${capitalize(z.name)} *(tuya)*\n`;
    }
  }

  text += `\nUsa /nueva-zona para añadir una zona personalizada.`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
}

export async function handleNewZone(ctx: Context): Promise<void> {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  if (!text) return;

  // Parse: "/nueva-zona 🍷 bodega" or "/nueva-zona bodega"
  const args = text.replace(/^\/nueva.zona\s*/i, '').trim();

  if (!args) {
    await ctx.reply(
      '❌ Escribe el nombre y opcionalmente un emoji.\n' +
      'Ejemplo: `/nueva-zona 🍷 bodega` o `/nueva-zona bodega`',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  // Try to extract emoji (first 1-2 unicode emoji characters)
  const emojiMatch = args.match(/^(\p{Extended_Pictographic}+)?\s*(.+)/u);
  const emoji = emojiMatch?.[1] || '📦';
  const name = (emojiMatch?.[2] || args).trim().toLowerCase();

  if (!name || name.length < 2) {
    await ctx.reply('❌ El nombre debe tener al menos 2 caracteres.');
    return;
  }

  try {
    const zone = await zonesRepo.createZone(ctx.from!.id, name, emoji);
    await ctx.reply(`✅ Zona ${zone.emoji} *${capitalize(zone.name)}* creada.`, {
      parse_mode: 'Markdown',
    });
  } catch (err: any) {
    if (err.message === 'ZONE_EXISTS') {
      await ctx.reply(`❌ Ya existe una zona llamada "${name}".`);
    } else {
      await ctx.reply('❌ Error al crear la zona. Inténtalo de nuevo.');
    }
  }
}

export async function handleRenameZone(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const zones = await zonesRepo.getZonesByUser(userId);
  const userZones = zones.filter((z) => !isSystemZone(z));

  if (userZones.length === 0) {
    await ctx.reply('❌ No tienes zonas personalizadas para renombrar.\n\nUsa /nueva-zona para crear una.');
    return;
  }

  const buttons = userZones.map((z) => [
    Markup.button.callback(
      `${z.emoji} ${capitalize(z.name)}`,
      `zone_rename_pick_${z.id}`,
    ),
  ]);
  buttons.push([Markup.button.callback('❌ Cancelar', 'zone_rename_cancel')]);

  await ctx.reply('📝 ¿Qué zona quieres renombrar?', {
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function handleRenamePick(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const zoneId = parseInt(ctx.callbackQuery.data.replace('zone_rename_pick_', ''), 10);
  const zone = await zonesRepo.getZoneById(zoneId);
  if (!zone) {
    await ctx.editMessageText('❌ Zona no encontrada.');
    return;
  }

  if (isSystemZone(zone)) {
    await ctx.editMessageText('❌ No puedes renombrar zonas del sistema.');
    return;
  }

  zoneWizardState.set(ctx.chat!.id, { step: 'awaiting_name', zoneId });

  await ctx.editMessageText(
    `📝 Escribe el nuevo nombre para ${zone.emoji} *${capitalize(zone.name)}*:`,
    { parse_mode: 'Markdown' },
  );
}

export async function handleRenameInput(ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  const state = zoneWizardState.get(chatId);
  if (!state || state.step !== 'awaiting_name') return;

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  if (!text) return;

  const newName = text.trim().toLowerCase();
  if (!newName || newName.length < 2) {
    await ctx.reply('❌ El nombre debe tener al menos 2 caracteres.');
    return;
  }

  try {
    const zone = await zonesRepo.renameZone(state.zoneId!, ctx.from!.id, newName);
    await ctx.reply(`✅ Zona renombrada a ${zone.emoji} *${capitalize(zone.name)}*.`, {
      parse_mode: 'Markdown',
    });
  } catch (err: any) {
    if (err.message === 'ZONE_EXISTS') {
      await ctx.reply(`❌ Ya existe una zona llamada "${newName}".`);
    } else if (err.message === 'FORBIDDEN') {
      await ctx.reply('❌ No puedes renombrar esta zona.');
    } else {
      await ctx.reply('❌ Error al renombrar la zona.');
    }
  }

  zoneWizardState.delete(chatId);
}

export async function handleDeleteZone(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const zones = await zonesRepo.getZonesByUser(userId);
  const userZones = zones.filter((z) => !isSystemZone(z));

  if (userZones.length === 0) {
    await ctx.reply('❌ No tienes zonas personalizadas para borrar.');
    return;
  }

  const buttons = userZones.map((z) => [
    Markup.button.callback(
      `${z.emoji} ${capitalize(z.name)}`,
      `zone_delete_pick_${z.id}`,
    ),
  ]);
  buttons.push([Markup.button.callback('❌ Cancelar', 'zone_delete_cancel')]);

  await ctx.reply('🗑 ¿Qué zona quieres borrar?', {
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function handleDeletePick(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const zoneId = parseInt(ctx.callbackQuery.data.replace('zone_delete_pick_', ''), 10);
  const zone = await zonesRepo.getZoneById(zoneId);
  if (!zone) {
    await ctx.editMessageText('❌ Zona no encontrada.');
    return;
  }

  if (isSystemZone(zone)) {
    await ctx.editMessageText('❌ No puedes borrar zonas del sistema.');
    return;
  }

  const buttons = Markup.inlineKeyboard([
    Markup.button.callback(`✅ Sí, borrar ${zone.emoji} ${capitalize(zone.name)}`, `zone_delete_confirm_${zoneId}`),
    Markup.button.callback('❌ Cancelar', 'zone_delete_cancel'),
  ]);

  await ctx.editMessageText(
    `🗑 ¿Estás seguro de que quieres borrar ${zone.emoji} *${capitalize(zone.name)}*?\n\n` +
    'Esta acción no se puede deshacer.',
    { parse_mode: 'Markdown', ...buttons },
  );
}

export async function handleDeleteConfirm(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const zoneId = parseInt(ctx.callbackQuery.data.replace('zone_delete_confirm_', ''), 10);

  try {
    await zonesRepo.deleteZone(zoneId, ctx.from!.id);
    await ctx.editMessageText('✅ Zona borrada.');
  } catch (err: any) {
    if (err.message === 'ZONE_NOT_EMPTY') {
      await ctx.editMessageText('❌ No se puede borrar la zona porque tiene productos. Mueve los productos primero.');
    } else if (err.message === 'FORBIDDEN') {
      await ctx.editMessageText('❌ No puedes borrar esta zona.');
    } else if (err.message === 'NOT_FOUND') {
      await ctx.editMessageText('❌ Zona no encontrada.');
    } else {
      await ctx.editMessageText('❌ Error al borrar la zona.');
    }
  }
}

export function handleRenameCancel(ctx: Context): void {
  if (!ctx.callbackQuery) return;
  ctx.editMessageText('❌ Operación cancelada.').catch(() => {});
  zoneWizardState.delete(ctx.chat!.id);
}

export function handleDeleteCancel(ctx: Context): void {
  if (!ctx.callbackQuery) return;
  ctx.editMessageText('❌ Operación cancelada.').catch(() => {});
  zoneWizardState.delete(ctx.chat!.id);
}
