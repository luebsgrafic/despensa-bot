import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  deepseekApiKey: requireEnv('DEEPSEEK_API_KEY'),
  databaseUrl: requireEnv('DATABASE_URL'),
  allowedUsers: requireEnv('TELEGRAM_ALLOWED_USERS')
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
