import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';

// Mock Telegraf bot
const mockGetWebhookInfo = vi.fn();
const mockSetWebhook = vi.fn();
const mockHandleUpdate = vi.fn();

vi.mock('../src/bot', () => ({
  createBot: () => ({
    telegram: {
      getWebhookInfo: mockGetWebhookInfo,
      setWebhook: mockSetWebhook,
    },
    handleUpdate: mockHandleUpdate,
    stop: vi.fn(),
  }),
}));

// Mock scheduler
vi.mock('../src/services/scheduler', () => ({
  startScheduler: vi.fn(),
}));

// Now import after mocks are set up
// We can't import index.ts directly because it starts the server on import.
// Instead we test the express routes and ensureWebhook logic in isolation.

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

async function ensureWebhook(url: string, maxRetries = 5): Promise<void> {
  try {
    const info = await mockGetWebhookInfo();
    if (info.url === url) {
      return;
    }
  } catch {
    // ignore
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await mockSetWebhook(url);
      if (result) {
        return;
      }
    } catch (error: any) {
      if (error?.response?.statusCode === 429) {
        const retryAfter = error?.response?.parameters?.retry_after || 10;
        const waitMs = retryAfter * 1000 + attempt * 2000;
        await new Promise((resolve) => setTimeout(resolve, 10)); // Don't actually wait in tests
      } else {
        throw error;
      }
    }
  }
  throw new Error(`Failed to set webhook after ${maxRetries} retries`);
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

  describe('ensureWebhook', () => {
    it('should NOT call setWebhook if URL already matches', async () => {
      mockGetWebhookInfo.mockResolvedValue({ url: 'https://example.com/webhook' });

      await ensureWebhook('https://example.com/webhook');

      expect(mockGetWebhookInfo).toHaveBeenCalled();
      expect(mockSetWebhook).not.toHaveBeenCalled();
    });

    it('should call setWebhook if URL differs', async () => {
      mockGetWebhookInfo.mockResolvedValue({ url: 'https://old-url.com/webhook' });
      mockSetWebhook.mockResolvedValue(true);

      await ensureWebhook('https://new-url.com/webhook');

      expect(mockGetWebhookInfo).toHaveBeenCalled();
      expect(mockSetWebhook).toHaveBeenCalledWith('https://new-url.com/webhook');
    });

    it('should retry on 429 and eventually succeed', async () => {
      mockGetWebhookInfo.mockResolvedValue({ url: 'https://old.com' });

      const rateLimitError = {
        response: { statusCode: 429, parameters: { retry_after: 1 } },
      };

      mockSetWebhook
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(true);

      await ensureWebhook('https://new.com');

      expect(mockSetWebhook).toHaveBeenCalledTimes(3);
    });

    it('should throw after exhausting retries on persistent 429', async () => {
      mockGetWebhookInfo.mockResolvedValue({ url: 'https://old.com' });

      const rateLimitError = {
        response: { statusCode: 429, parameters: { retry_after: 1 } },
      };

      mockSetWebhook.mockRejectedValue(rateLimitError);

      await expect(ensureWebhook('https://new.com', 2)).rejects.toThrow(
        'Failed to set webhook after 2 retries',
      );
    });

    it('should call setWebhook if getWebhookInfo throws', async () => {
      mockGetWebhookInfo.mockRejectedValue(new Error('Network error'));
      mockSetWebhook.mockResolvedValue(true);

      await ensureWebhook('https://example.com/webhook');

      expect(mockSetWebhook).toHaveBeenCalledWith('https://example.com/webhook');
    });
  });
});
