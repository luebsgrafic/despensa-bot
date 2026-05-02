import { Middleware, Context } from 'telegraf';
import { config } from '../utils/config';

export function authMiddleware(): Middleware<Context> {
  return (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }

    if (!config.allowedUsers.includes(userId)) {
      ctx.reply(
        '⛔ Lo siento, no tienes permiso para usar este bot.\n' +
          'Si crees que es un error, contacta con el administrador.',
      );
      return;
    }

    return next();
  };
}
