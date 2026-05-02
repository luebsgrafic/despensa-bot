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
  deepseekApiKey: requireEnv('DEEPSEEK_API_KEY'),
  databaseUrl: requireEnv('DATABASE_URL'),
  allowedUsers: (process.env.TELEGRAM_ALLOWED_USERS || '')
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id)),

  deepseekModel: 'deepseek-v4-flash',
  deepseekBaseUrl: 'https://api.deepseek.com',
  deepseekMaxTokens: 300,

  alertHour: 9,
  alertMinute: 0,
  expirationWarningDays: 3,
} as const;
