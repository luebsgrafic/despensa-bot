import { Middleware, Context } from 'telegraf';

// No-op middleware — all users are allowed
export function authMiddleware(): Middleware<Context> {
  return (_ctx, next) => next();
}
