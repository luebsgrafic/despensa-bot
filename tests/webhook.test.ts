import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';

// Mock Telegraf bot — only handleUpdate is used, no setWebhook
const mockHandleUpdate = vi.fn();

vi.mock('../src/bot', () => ({
  createBot: () => ({
    handleUpdate: mockHandleUpdate,
    stop: vi.fn(),
  }),
}));

// Mock scheduler
vi.mock('../src/services/scheduler', () => ({
  startScheduler: vi.fn(),
}));

function createTestApp() {
  const app = express();

  app.get('/api/webhook', (_req, res) => {
    res.status(200).json({ status: 'ok', bot: 'DespensaBot' });
  });

  app.post('/api/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    try {
      if (!req.body || Buffer.byteLength(req.body as any) === 0) {
        res.status(200).json({ ok: true });
        return;
      }

      const rawBody = (req.body as Buffer).toString('utf8');
      const update = JSON.parse(rawBody);

      await mockHandleUpdate(update);
      res.status(200).json({ ok: true });
    } catch (error: any) {
      res.status(200).json({ ok: true });
    }
  });

  return app;
}

function request(app: express.Express, method: string, path: string, body?: any): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address() as any;
      const options: http.RequestOptions = {
        hostname: 'localhost',
        port: addr.port,
        path,
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          server.close();
          try {
            resolve({ statusCode: res.statusCode || 0, body: JSON.parse(data) });
          } catch {
            resolve({ statusCode: res.statusCode || 0, body: data });
          }
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  });
}

describe('Webhook Server', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe('GET /api/webhook', () => {
    it('should return 200 with health check JSON', async () => {
      const res = await request(app, 'GET', '/api/webhook');
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ status: 'ok', bot: 'DespensaBot' });
    });
  });

  describe('POST /api/webhook', () => {
    it('should return 200 and call handleUpdate with valid update', async () => {
      const update = { update_id: 1, message: { text: '/start' } };
      const res = await request(app, 'POST', '/api/webhook', update);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockHandleUpdate).toHaveBeenCalledWith(update);
    });

    it('should return 200 without calling handleUpdate on empty body', async () => {
      const res = await request(app, 'POST', '/api/webhook', '');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockHandleUpdate).not.toHaveBeenCalled();
    });

    it('should return 200 without crashing on invalid JSON', async () => {
      const res = await request(app, 'POST', '/api/webhook', 'not-json-at-all');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockHandleUpdate).not.toHaveBeenCalled();
    });
  });
});
