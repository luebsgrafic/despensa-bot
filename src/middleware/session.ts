import { session, MemorySessionStore } from 'telegraf';
import { SessionData } from '../types';

const defaultSession = (): SessionData => ({
  wizard: {
    step: 'idle',
    data: {},
  },
});

const store = new MemorySessionStore<SessionData>();

export const sessionMiddleware = session({
  defaultSession,
  store,
});
