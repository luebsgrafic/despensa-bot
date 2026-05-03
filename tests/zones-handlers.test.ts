import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB functions
const mockGetZonesByUser = vi.fn();
const mockGetZoneById = vi.fn();
const mockCreateZone = vi.fn();
const mockRenameZone = vi.fn();
const mockDeleteZone = vi.fn();

vi.mock('../src/db', () => ({
  zones: {
    getZonesByUser: (...args: any[]) => mockGetZonesByUser(...args),
    getZoneById: (...args: any[]) => mockGetZoneById(...args),
    createZone: (...args: any[]) => mockCreateZone(...args),
    renameZone: (...args: any[]) => mockRenameZone(...args),
    deleteZone: (...args: any[]) => mockDeleteZone(...args),
  },
}));

import { showZones, handleNewZone, handleRenameZone, handleDeleteZone } from '../src/handlers/zones';

function createCtx(overrides: Record<string, any> = {}): any {
  return {
    from: { id: 12345 },
    chat: { id: 12345 },
    message: { text: '' },
    reply: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    answerCbQuery: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const DEFAULT_ZONES = [
  { id: 1, user_id: null, name: 'nevera', emoji: '🧊' },
  { id: 2, user_id: null, name: 'congelador', emoji: '❄️' },
  { id: 3, user_id: null, name: 'armario_cocina', emoji: '🚪' },
  { id: 4, user_id: null, name: 'despensa', emoji: '📦' },
  { id: 5, user_id: null, name: 'otros', emoji: '📌' },
];

describe('Zone handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('showZones', () => {
    it('should list 5 default zones for new user', async () => {
      mockGetZonesByUser.mockResolvedValue(DEFAULT_ZONES);

      const ctx = createCtx();
      await showZones(ctx);

      expect(mockGetZonesByUser).toHaveBeenCalledWith(12345);
      expect(ctx.reply).toHaveBeenCalled();
      const replyText = ctx.reply.mock.calls[0][0];
      expect(replyText).toContain('Nevera');
      expect(replyText).toContain('Congelador');
      expect(replyText).toContain('Despensa');
      expect(replyText).toContain('sistema');
    });

    it('should include custom user zones', async () => {
      mockGetZonesByUser.mockResolvedValue([
        ...DEFAULT_ZONES,
        { id: 10, user_id: 12345, name: 'bodega', emoji: '🍷' },
      ]);

      const ctx = createCtx();
      await showZones(ctx);

      const replyText = ctx.reply.mock.calls[0][0];
      expect(replyText).toContain('Bodega');
      expect(replyText).toContain('tuya');
    });
  });

  describe('handleNewZone', () => {
    it('should create a zone with emoji and name', async () => {
      mockCreateZone.mockResolvedValue({ id: 10, user_id: 12345, name: 'bodega', emoji: '🍷' });

      const ctx = createCtx({ message: { text: '/nueva-zona 🍷 bodega' } });
      await handleNewZone(ctx);

      expect(mockCreateZone).toHaveBeenCalledWith(12345, 'bodega', '🍷');
      expect(ctx.reply).toHaveBeenCalled();
      const replyText = ctx.reply.mock.calls[0][0];
      expect(replyText).toContain('Bodega');
    });

    it('should create a zone without emoji', async () => {
      mockCreateZone.mockResolvedValue({ id: 11, user_id: 12345, name: 'test', emoji: '📦' });

      const ctx = createCtx({ message: { text: '/nueva-zona test' } });
      await handleNewZone(ctx);

      expect(mockCreateZone).toHaveBeenCalledWith(12345, 'test', '📦');
    });

    it('should show error for duplicate name', async () => {
      mockCreateZone.mockRejectedValue(new Error('ZONE_EXISTS'));

      const ctx = createCtx({ message: { text: '/nueva-zona 🍷 bodega' } });
      await handleNewZone(ctx);

      const replyText = ctx.reply.mock.calls[0][0];
      expect(replyText).toContain('Ya existe');
    });

    it('should show usage when no args given', async () => {
      const ctx = createCtx({ message: { text: '/nueva-zona' } });
      await handleNewZone(ctx);

      const replyText = ctx.reply.mock.calls[0][0];
      expect(replyText).toContain('Ejemplo');
    });
  });

  describe('handleRenameZone', () => {
    it('should show zone picker when user has custom zones', async () => {
      mockGetZonesByUser.mockResolvedValue([
        ...DEFAULT_ZONES,
        { id: 10, user_id: 12345, name: 'bodega', emoji: '🍷' },
      ]);

      const ctx = createCtx();
      await handleRenameZone(ctx);

      expect(ctx.reply).toHaveBeenCalled();
      const keyboard = ctx.reply.mock.calls[0][1]?.reply_markup;
      expect(keyboard).toBeDefined();
    });

    it('should show error when user has no custom zones', async () => {
      mockGetZonesByUser.mockResolvedValue(DEFAULT_ZONES);

      const ctx = createCtx();
      await handleRenameZone(ctx);

      const replyText = ctx.reply.mock.calls[0][0];
      expect(replyText).toContain('No tienes zonas personalizadas');
    });
  });

  describe('handleDeleteZone', () => {
    it('should show zone picker when user has custom zones', async () => {
      mockGetZonesByUser.mockResolvedValue([
        ...DEFAULT_ZONES,
        { id: 10, user_id: 12345, name: 'bodega', emoji: '🍷' },
      ]);

      const ctx = createCtx();
      await handleDeleteZone(ctx);

      expect(ctx.reply).toHaveBeenCalled();
      const keyboard = ctx.reply.mock.calls[0][1]?.reply_markup;
      expect(keyboard).toBeDefined();
    });

    it('should show error when user has no custom zones', async () => {
      mockGetZonesByUser.mockResolvedValue(DEFAULT_ZONES);

      const ctx = createCtx();
      await handleDeleteZone(ctx);

      const replyText = ctx.reply.mock.calls[0][0];
      expect(replyText).toContain('No tienes zonas personalizadas');
    });
  });
});
