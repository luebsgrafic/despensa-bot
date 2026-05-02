import { Context, Markup } from 'telegraf';
import { products as productsRepo, movements } from '../db';
import {
  STORAGE_ZONES,
  PRODUCT_UNITS,
  ZONE_EMOJIS,
  StorageZone,
  ProductUnit,
  SessionData,
} from '../types';

const UNIT_LABELS: Record<ProductUnit, string> = {
  ud: 'unidades',
  kg: 'kg',
  L: 'litros',
  g: 'gramos',
  ml: 'mililitros',
};

export function startAddWizard(ctx: Context): void {
  const session = (ctx as any).session as SessionData;
  session.wizard = {
    step: 'ask_name',
    data: {},
  };

  ctx.reply('🧑‍🍳 ¿Qué producto quieres añadir? (escribe el nombre)', {
    reply_markup: { force_reply: true },
  });
}

export async function handleWizardInput(ctx: Context): Promise<void> {
  const session = (ctx as any).session as SessionData;
  if (!session.wizard || session.wizard.step === 'idle') return;

  const text = (ctx.message as any)?.text;
  if (!text) return;

  switch (session.wizard.step) {
    case 'ask_name':
      session.wizard.data.name = text.trim();
      session.wizard.step = 'ask_zone';
      await askZone(ctx);
      break;

    case 'ask_quantity_unit':
      await handleQuantityInput(ctx, session, text);
      break;

    case 'ask_expiration':
      await handleExpirationInput(ctx, session, text);
      break;

    case 'ask_min_stock':
      await handleMinStockInput(ctx, session, text);
      break;
  }
}

async function askZone(ctx: Context): Promise<void> {
  const buttons = STORAGE_ZONES.map((zone) => [
    Markup.button.callback(
      `${ZONE_EMOJIS[zone]} ${capitalize(zone)}`,
      `wizard_zone_${zone}`,
    ),
  ]);

  await ctx.reply('📦 ¿En qué zona está el producto?', {
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function handleZoneSelection(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const session = (ctx as any).session as SessionData;
  const zone = ctx.callbackQuery.data.replace('wizard_zone_', '') as StorageZone;

  session.wizard.data.zone = zone;
  session.wizard.step = 'ask_quantity_unit';

  const buttons = PRODUCT_UNITS.map((unit) => [
    Markup.button.callback(UNIT_LABELS[unit], `wizard_unit_${unit}`),
  ]);

  await ctx.editMessageText(
    `✅ Zona: ${ZONE_EMOJIS[zone]} ${capitalize(zone)}\n\n` +
      '🔢 ¿Qué cantidad y unidad? (ej: 2 kg, 500 g, 3 ud)\n\n' +
      'O selecciona la unidad con los botones y escribe solo el número:',
    {
      reply_markup: { inline_keyboard: buttons },
    },
  );
}

export async function handleUnitSelection(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const session = (ctx as any).session as SessionData;
  const unit = ctx.callbackQuery.data.replace('wizard_unit_', '') as ProductUnit;

  session.wizard.data.unit = unit;

  await ctx.editMessageText(
    `Unidad seleccionada: ${UNIT_LABELS[unit]}\n` +
      'Ahora escribe solo la cantidad (ej: 2, 0.5, 3):',
    {
      reply_markup: { force_reply: true },
    },
  );
}

async function handleQuantityInput(
  ctx: Context,
  session: SessionData,
  text: string,
): Promise<void> {
  // Try to parse "2 kg", "500g", "3 ud", etc.
  const match = text.match(/^([\d.]+)\s*(ud|kg|L|l|g|ml)?$/i);
  if (!match) {
    await ctx.reply(
      '❌ No entendí la cantidad. Escribe algo como "2 kg", "500 g" o solo "3"',
      { reply_markup: { force_reply: true } },
    );
    return;
  }

  const quantity = parseFloat(match[1]);
  if (isNaN(quantity) || quantity <= 0) {
    await ctx.reply('❌ La cantidad debe ser un número positivo', {
      reply_markup: { force_reply: true },
    });
    return;
  }

  session.wizard.data.quantity = quantity;

  if (match[2]) {
    const unit = match[2].toLowerCase() as ProductUnit;
    // Normalize 'l' to 'L'
    session.wizard.data.unit = unit === 'l' ? 'L' : unit;
  }
  // If no unit in text, user must have selected via button (already in session)

  session.wizard.step = 'ask_expiration';
  await askExpiration(ctx);
}

async function askExpiration(ctx: Context): Promise<void> {
  const buttons = [
    Markup.button.callback('📅 Sin fecha de caducidad', 'wizard_no_expiry'),
  ];

  await ctx.reply(
    '📅 ¿Tiene fecha de caducidad? (escribe en formato DD/MM/AAAA)\n' +
      'O pulsa el botón si no caduca:',
    {
      reply_markup: { inline_keyboard: [buttons] },
    },
  );
}

async function handleExpirationInput(
  ctx: Context,
  session: SessionData,
  text: string,
): Promise<void> {
  // Try to parse date in DD/MM/YYYY or YYYY-MM-DD
  const dateMatch = text.match(
    /^(\d{2})\/(\d{2})\/(\d{4})$|^(\d{4})-(\d{2})-(\d{2})$/,
  );

  if (!dateMatch) {
    await ctx.reply(
      '❌ Formato no válido. Usa DD/MM/AAAA (ej: 15/06/2026) o pulsa "Sin fecha"',
      { reply_markup: { force_reply: true } },
    );
    return;
  }

  // Normalize to YYYY-MM-DD
  let dateStr: string;
  if (dateMatch[1]) {
    dateStr = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  } else {
    dateStr = `${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`;
  }

  session.wizard.data.expiration_date = dateStr;
  session.wizard.step = 'ask_min_stock';
  await askMinStock(ctx);
}

export async function handleNoExpiry(ctx: Context): Promise<void> {
  const session = (ctx as any).session as SessionData;
  session.wizard.data.expiration_date = null;
  session.wizard.step = 'ask_min_stock';
  await ctx.editMessageText('✅ Sin fecha de caducidad.');
  await askMinStock(ctx);
}

async function askMinStock(ctx: Context): Promise<void> {
  const buttons = [
    Markup.button.callback('🚫 Sin stock mínimo', 'wizard_no_minstock'),
  ];

  await ctx.reply(
    '⚠️ ¿Quieres establecer un stock mínimo?\n' +
      'Cuando el producto baje de esa cantidad, te avisaré para reponer.\n\n' +
      'Escribe el número o pulsa "Sin stock mínimo":',
    {
      reply_markup: { inline_keyboard: [buttons] },
    },
  );
}

async function handleMinStockInput(
  ctx: Context,
  session: SessionData,
  text: string,
): Promise<void> {
  const num = parseFloat(text.trim());
  if (isNaN(num) || num < 0) {
    await ctx.reply('❌ Escribe un número válido (0 o más) o pulsa "Sin stock mínimo"', {
      reply_markup: { force_reply: true },
    });
    return;
  }

  session.wizard.data.min_stock = num;
  await showConfirmation(ctx, session);
}

export async function handleNoMinStock(ctx: Context): Promise<void> {
  const session = (ctx as any).session as SessionData;
  session.wizard.data.min_stock = null;
  await ctx.editMessageText('✅ Sin stock mínimo.');
  await showConfirmation(ctx, session);
}

async function showConfirmation(
  ctx: Context,
  session: SessionData,
): Promise<void> {
  const d = session.wizard.data;
  const expiryText = d.expiration_date
    ? formatDate(d.expiration_date)
    : 'Sin caducidad';
  const minStockText =
    d.min_stock !== null ? `${d.min_stock} ${d.unit}` : 'Sin mínimo';

  const summary =
    `📋 *Resumen del producto*\n\n` +
    `• Nombre: ${d.name}\n` +
    `• Zona: ${ZONE_EMOJIS[d.zone!]} ${capitalize(d.zone!)}\n` +
    `• Cantidad: ${d.quantity} ${d.unit}\n` +
    `• Caducidad: ${expiryText}\n` +
    `• Stock mínimo: ${minStockText}\n\n` +
    `¿Guardamos?`;

  const buttons = Markup.inlineKeyboard([
    Markup.button.callback('✅ Sí, guardar', 'wizard_save'),
    Markup.button.callback('❌ Cancelar', 'wizard_cancel'),
  ]);

  await ctx.reply(summary, {
    parse_mode: 'Markdown',
    ...buttons,
  });
}

export async function handleSave(ctx: Context): Promise<void> {
  const session = (ctx as any).session as SessionData;
  const d = session.wizard.data;

  if (!d.name || !d.zone || d.quantity === undefined || !d.unit) {
    await ctx.editMessageText('❌ Faltan datos. Empieza de nuevo con /start');
    session.wizard = { step: 'idle', data: {} };
    return;
  }

  try {
    const product = await productsRepo.createProduct({
      name: d.name,
      quantity: d.quantity,
      unit: d.unit,
      zone: d.zone,
      min_stock: d.min_stock,
      expiration_date: d.expiration_date,
    });

    await movements.logMovement(
      product.id,
      'added',
      null,
      `${d.quantity} ${d.unit} en ${d.zone}`,
      ctx.from!.id,
    );

    await ctx.editMessageText(
      `✅ *${d.name}* añadido correctamente a ${ZONE_EMOJIS[d.zone]} ${capitalize(d.zone)}.\n\n` +
        `Cantidad: ${d.quantity} ${d.unit}` +
        (d.expiration_date
          ? `\nCaduca: ${formatDate(d.expiration_date)}`
          : '') +
        (d.min_stock !== null ? `\nStock mínimo: ${d.min_stock} ${d.unit}` : ''),
      { parse_mode: 'Markdown' },
    );
  } catch (error) {
    await ctx.editMessageText(
      '❌ Error al guardar el producto. Inténtalo de nuevo.',
    );
  }

  session.wizard = { step: 'idle', data: {} };
}

export async function handleCancel(ctx: Context): Promise<void> {
  const session = (ctx as any).session as SessionData;
  session.wizard = { step: 'idle', data: {} };
  await ctx.editMessageText('❌ Operación cancelada.');
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
    year: 'numeric',
  });
}
