import { Context, Markup } from 'telegraf';

export const MAIN_MENU_KEYBOARD = {
  keyboard: [
    [{ text: '📦 Ver despensa' }, { text: '➕ Añadir' }],
    [{ text: '🛒 Lista compra' }, { text: '🍳 ¿Qué como?' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

/**
 * Sends the main menu keyboard to the user without any extra message.
 * Use this to ensure the persistent keyboard is always visible.
 */
export async function showMainMenu(ctx: Context): Promise<void> {
  try {
    await ctx.reply('📋 Menú principal:', {
      reply_markup: MAIN_MENU_KEYBOARD,
    });
  } catch {
    // Silently fail — keyboard is a best-effort UX improvement
  }
}

export function startHandler(ctx: Context): void {
  const userName = ctx.from?.first_name || 'Usuario';

  const welcomeMessage =
    `¡Bienvenido, ${userName}! 🏠\n\n` +
    `Soy el bot de la despensa familiar. Puedo ayudarte a:\n` +
    `📦 Llevar el control de lo que hay en casa\n` +
    `➕ Añadir productos cuando lleguen\n` +
    `➖ Registrar lo que se gasta\n` +
    `🛒 Gestionar la lista de la compra\n` +
    `🍳 Sugerir recetas con lo que tienes\n\n` +
    `Usa los botones de abajo para empezar 👇`;

  ctx.reply(welcomeMessage, {
    reply_markup: MAIN_MENU_KEYBOARD,
  });
}
