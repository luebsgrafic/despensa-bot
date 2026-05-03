import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Only load .env if it exists (it won't in Vercel)
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  geminiApiKey: requireEnv('GEMINI_API_KEY'),
  databaseUrl: requireEnv('DATABASE_URL'),
  databaseUrlTest: process.env['DATABASE_URL_TEST'] || '',
  mem0ApiKey: process.env['MEM0_API_KEY'] || '',

  geminiModel: process.env['GEMINI_MODEL'] || 'gemini-2.5-flash-lite',
  geminiMaxTokens: 800,

  alertHour: 9,
  alertMinute: 0,
  expirationWarningDays: 3,
} as const;
