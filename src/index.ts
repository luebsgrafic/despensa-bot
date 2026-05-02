import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import http from 'http';

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log('[Config] Loaded .env from:', envPath);
}

import { createBot } from './bot';
import { startScheduler } from './services/scheduler';

const bot = createBot();
const PORT = parseInt(process.env.PORT || '3000', 10);

console.log('[Config] PORT:', PORT);

async function main() {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/webhook') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', bot: 'DespensaBot' }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/webhook') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const update = JSON.parse(body);
          await bot.handleUpdate(update);
          res.writeHead(200);
          res.end('OK');
        } catch (err) {
          res.writeHead(500);
          res.end('Error');
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(PORT, () => {
    console.log(`🤖 DespensaBot running on port ${PORT}`);
  });

  startScheduler(bot);

  process.once('SIGINT', () => { server.close(); bot.stop(); });
  process.once('SIGTERM', () => { server.close(); bot.stop(); });
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
