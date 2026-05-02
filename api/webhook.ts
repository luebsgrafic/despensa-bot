import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createBot } from '../src/bot';

// Disable Vercel body parser — Telegraf handles raw body
export const config = {
  api: {
    bodyParser: false,
  },
};

const bot = createBot();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    res.status(200).json({ status: 'ok', bot: 'DespensaBot' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Read raw body from Vercel stream
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const update = JSON.parse(rawBody);

    await bot.handleUpdate(update);

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).json({ ok: true });
  }
}
