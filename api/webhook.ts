import type { VercelRequest, VercelResponse } from '@vercel/node';

// Disable Vercel body parser — Telegraf handles raw body
export const config = {
  api: {
    bodyParser: false,
  },
};

let bot: any = null;

async function getBot() {
  if (!bot) {
    const { createBot } = await import('../src/bot');
    bot = createBot();
  }
  return bot;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('[Webhook] Method:', req.method);

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
    console.log('[Webhook] Body received, length:', rawBody.length);

    const update = JSON.parse(rawBody);
    console.log('[Webhook] Update type:', Object.keys(update).join(', '));

    const botInstance = await getBot();
    await botInstance.handleUpdate(update);

    console.log('[Webhook] Update handled successfully');
    res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('[Webhook] Error:', error?.message || error);
    console.error('[Webhook] Stack:', error?.stack);
    // Always return 200 to Telegram so it doesn't retry indefinitely
    res.status(200).json({ ok: true, error: error?.message });
  }
}
