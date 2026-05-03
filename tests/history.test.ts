import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetRecentMovements = vi.fn();
const mockGetMovementsByProduct = vi.fn();
const mockSearchProducts = vi.fn();
const mockGetAllProducts = vi.fn();

vi.mock('../src/db', () => ({
  movements: {
    getRecentMovements: (...args: any[]) => mockGetRecentMovements(...args),
    getMovementsByProduct: (...args: any[]) => mockGetMovementsByProduct(...args),
  },
  products: {
    searchProducts: (...args: any[]) => mockSearchProducts(...args),
    getAllProducts: (...args: any[]) => mockGetAllProducts(...args),
  },
}));

import { showHistory } from '../src/handlers/history';

function createCtx(overrides: Record<string, any> = {}): any {
  return {
    message: { text: '/historial' },
    chat: { id: 12345 },
    from: { id: 67890 },
    reply: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('History Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('/historial — all recent movements', () => {
    it('should show last 10 movements when called without arguments', async () => {
      const ctx = createCtx();
      const now = new Date().toISOString();
      mockGetRecentMovements.mockResolvedValue([
        {
          id: 1, product_id: 1, action: 'added',
          previous_value: null, new_value: '2 L en nevera', created_at: now,
        },
        {
          id: 2, product_id: 2, action: 'consumed',
          previous_value: '1 kg', new_value: '0.5 kg', created_at: now,
        },
      ]);
      mockGetAllProducts.mockResolvedValue([
        { id: 1, name: 'Leche' },
        { id: 2, name: 'Arroz' },
      ]);

      await showHistory(ctx);

      expect(mockGetRecentMovements).toHaveBeenCalledWith(10);
      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const text = ctx.reply.mock.calls[0][0];
      expect(text).toContain('Leche');
      expect(text).toContain('Arroz');
      expect(text).toContain('➕');
      expect(text).toContain('➖');
    });

    it('should show empty message when no movements exist', async () => {
      const ctx = createCtx();
      mockGetRecentMovements.mockResolvedValue([]);

      await showHistory(ctx);

      expect(mockGetRecentMovements).toHaveBeenCalledWith(10);
      expect(ctx.reply).toHaveBeenCalledWith('📋 No hay movimientos registrados.');
    });

    it('should show less than 10 movements when fewer exist', async () => {
      const ctx = createCtx();
      const now = new Date().toISOString();
      mockGetRecentMovements.mockResolvedValue([
        {
          id: 1, product_id: 1, action: 'added',
          previous_value: null, new_value: '1 ud', created_at: now,
        },
        {
          id: 2, product_id: 1, action: 'consumed',
          previous_value: '1 ud', new_value: '0 ud', created_at: now,
        },
      ]);
      mockGetAllProducts.mockResolvedValue([{ id: 1, name: 'Item' }]);

      await showHistory(ctx);

      const text = ctx.reply.mock.calls[0][0];
      expect(text).toContain('➕');
      expect(text).toContain('➖');
      const emojiCount = (text.match(/[\u{2795}\u{2796}]/gu) || []).length;
      expect(emojiCount).toBe(2);
    });
  });

  describe('/historial <product>', () => {
    it('should show product-specific history', async () => {
      const ctx = createCtx({ message: { text: '/historial Leche' } });
      const now = new Date().toISOString();
      mockSearchProducts.mockResolvedValue([
        { id: 1, name: 'Leche', quantity: 2, unit: 'L' },
      ]);
      mockGetMovementsByProduct.mockResolvedValue([
        {
          id: 1, product_id: 1, action: 'added',
          previous_value: null, new_value: '2 L en nevera', created_at: now,
        },
      ]);

      await showHistory(ctx);

      expect(mockSearchProducts).toHaveBeenCalledWith('Leche');
      expect(mockGetMovementsByProduct).toHaveBeenCalledWith(1, 10);
      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const text = ctx.reply.mock.calls[0][0];
      expect(text).toContain('Leche');
      expect(text).toContain('➕');
    });

    it('should show error for non-existent product', async () => {
      const ctx = createCtx({ message: { text: '/historial XYZ' } });
      mockSearchProducts.mockResolvedValue([]);

      await showHistory(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        '❌ No encontré "XYZ" en la despensa.',
      );
    });

    it('should show empty message when product has no movements', async () => {
      const ctx = createCtx({ message: { text: '/historial Leche' } });
      mockSearchProducts.mockResolvedValue([{ id: 1, name: 'Leche' }]);
      mockGetMovementsByProduct.mockResolvedValue([]);

      await showHistory(ctx);

      const text = ctx.reply.mock.calls[0][0];
      expect(text).toContain('No hay movimientos');
      expect(text).toContain('Leche');
    });
  });

  describe('emoji formatting', () => {
    it('should show correct emoji for each action type', async () => {
      const ctx = createCtx();
      const now = new Date().toISOString();
      mockGetRecentMovements.mockResolvedValue([
        { id: 1, product_id: 1, action: 'added', previous_value: null, new_value: '2 L', created_at: now },
        { id: 2, product_id: 1, action: 'consumed', previous_value: '2 L', new_value: '1 L', created_at: now },
        { id: 3, product_id: 1, action: 'moved', previous_value: 'nevera', new_value: 'congelador', created_at: now },
        { id: 4, product_id: 1, action: 'restocked', previous_value: null, new_value: '2 L', created_at: now },
        { id: 5, product_id: 1, action: 'depleted', previous_value: '1 L', new_value: '0 L', created_at: now },
      ]);
      mockGetAllProducts.mockResolvedValue([{ id: 1, name: 'Test' }]);

      await showHistory(ctx);

      const text = ctx.reply.mock.calls[0][0];
      expect(text).toContain('➕');
      expect(text).toContain('➖');
      expect(text).toContain('📦');
      expect(text).toContain('📥');
      expect(text).toContain('⚠️');
    });
  });
});
