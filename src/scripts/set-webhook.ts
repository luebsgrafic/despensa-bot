/**
 * Script to set the Telegram bot webhook URL for Vercel deployment.
 *
 * Usage:
 *   npm run set-webhook -- https://<your-project>.vercel.app/api/webhook
 *
 * Requires TELEGRAM_BOT_TOKEN in .env
 */

import { config } from '../utils/config';

const webhookUrl = process.argv[2];

if (!webhookUrl) {
  console.error('Usage: npm run set-webhook -- https://<project>.vercel.app/api/webhook');
  process.exit(1);
}

async function main() {
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;

  const response = await fetch(url, { method: 'POST' });
  const data = (await response.json()) as { ok: boolean; description?: string };

  if (data.ok) {
    console.log('✅ Webhook set successfully!');
    console.log(`   URL: ${webhookUrl}`);
  } else {
    console.error('❌ Failed to set webhook:', data.description);
    process.exit(1);
  }
}

main().catch(console.error);
