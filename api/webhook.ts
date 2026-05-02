import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createBot } from '../src/bot';

// Desactivar body parsing de Vercel, Telegraf maneja el raw body
export const config = {
  api: {
    bodyParser: false,
  },
};

const bot = createBot();

// En Vercel, el webhook se configura con:
// TELEGRAM_BOT_TOKEN + WEBHOOK_URL = https://<project>.vercel.app/api/webhook
// Para configurar: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL>

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    // Health check
    res.status(200).json({ status: 'ok', bot: 'DespensaBot' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Get raw body from Vercel
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const update = JSON.parse(rawBody);

    // Process update via Telegraf
    await bot.handleUpdate(update);

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).json({ ok: true }); // Always return 200 to Telegram
  }
}
