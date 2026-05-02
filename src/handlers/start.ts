import { Context, Markup } from 'telegraf';
import { config } from '../utils/config';

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
    reply_markup: {
      keyboard: [
        [{ text: '📦 Ver despensa' }, { text: '➕ Añadir' }],
        [{ text: '🛒 Lista compra' }, { text: '🍳 ¿Qué como?' }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    },
  });
}
