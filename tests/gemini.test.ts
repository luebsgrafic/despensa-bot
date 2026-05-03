import { describe, it, expect, vi, beforeEach } from 'vitest';

// Expose mock functions for assertions
const mockGetRecentMessages = vi.fn();
const mockSaveMessage = vi.fn();
const mockStartChatFn = vi.fn();

vi.mock('../src/db', () => ({
  products: {
    getAllProducts: vi.fn().mockResolvedValue([]),
  },
  shopping: {
    getUncheckedItems: vi.fn().mockResolvedValue([]),
  },
  zones: {
    getZonesByUser: vi.fn().mockResolvedValue([]),
  },
  conversations: {
    getRecentMessages: (...args: any[]) => mockGetRecentMessages(...args),
    saveMessage: (...args: any[]) => mockSaveMessage(...args),
  },
}));

vi.mock('@google/generative-ai', () => {
  class GoogleGenerativeAI {
    constructor(_apiKey: string) {}
    getGenerativeModel() {
      return {
        startChat: (...args: any[]) => {
          mockStartChatFn(...args);
          return {
            sendMessage: async () => ({
              response: { text: () => 'Respuesta de prueba' },
            }),
          };
        },
        generateContent: vi.fn(),
      };
    }
  }
  return { GoogleGenerativeAI };
});

import { safeReply, processWithAI } from '../src/services/gemini';

describe('safeReply', () => {
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = {
      reply: vi.fn().mockResolvedValue(undefined),
    };
    vi.clearAllMocks();
  });

  it('should use fallback when message.content is empty', async () => {
    await safeReply(mockCtx, '');

    const callArgs = mockCtx.reply.mock.calls[0];
    expect(callArgs[0]).toBe(
      'No he podido interpretar bien el mensaje. ¿Puedes decirme el producto, cantidad y zona? Ejemplo: añadir 2 kg de pollo en congelador.',
    );
    expect(mockCtx.reply).not.toHaveBeenCalledWith('');
  });

  it('should call ctx.reply with normal text unchanged', async () => {
    await safeReply(mockCtx, 'Hola, esto es un mensaje normal');
    const callArgs = mockCtx.reply.mock.calls[0];
    expect(callArgs[0]).toBe('Hola, esto es un mensaje normal');
  });

  it('should NOT call ctx.reply with empty string — use fallback instead', async () => {
    await safeReply(mockCtx, '');
    const callArgs = mockCtx.reply.mock.calls[0];
    expect(callArgs[0]).toBe(
      'No he podido interpretar bien el mensaje. ¿Puedes decirme el producto, cantidad y zona? Ejemplo: añadir 2 kg de pollo en congelador.',
    );
  });

  it('should NOT call ctx.reply with undefined — use fallback instead', async () => {
    await safeReply(mockCtx, undefined);
    const callArgs = mockCtx.reply.mock.calls[0];
    expect(callArgs[0]).toBe(
      'No he podido interpretar bien el mensaje. ¿Puedes decirme el producto, cantidad y zona? Ejemplo: añadir 2 kg de pollo en congelador.',
    );
  });

  it('should NOT call ctx.reply with null — use fallback instead', async () => {
    await safeReply(mockCtx, null);
    const callArgs = mockCtx.reply.mock.calls[0];
    expect(callArgs[0]).toBe(
      'No he podido interpretar bien el mensaje. ¿Puedes decirme el producto, cantidad y zona? Ejemplo: añadir 2 kg de pollo en congelador.',
    );
  });

  it('should NOT call ctx.reply with whitespace-only string — use fallback instead', async () => {
    await safeReply(mockCtx, '   ');
    const callArgs = mockCtx.reply.mock.calls[0];
    expect(callArgs[0]).toBe(
      'No he podido interpretar bien el mensaje. ¿Puedes decirme el producto, cantidad y zona? Ejemplo: añadir 2 kg de pollo en congelador.',
    );
  });

  it('should handle text with underscores without Markdown errors', async () => {
    const text = 'El producto está en armario_cocina';
    await safeReply(mockCtx, text);
    const callArgs = mockCtx.reply.mock.calls[0];
    expect(callArgs[0]).toBe(text);
  });

  it('should truncate text longer than 4096 characters', async () => {
    const longText = 'a'.repeat(5000);
    await safeReply(mockCtx, longText);

    const calledWith = mockCtx.reply.mock.calls[0][0];
    expect(calledWith.length).toBeLessThanOrEqual(4096);
    expect(calledWith.endsWith('...')).toBe(true);
  });

  it('should convert number to string', async () => {
    await safeReply(mockCtx, 42);
    const callArgs = mockCtx.reply.mock.calls[0];
    expect(callArgs[0]).toBe('42');
  });

  it('should convert object to string', async () => {
    await safeReply(mockCtx, { foo: 'bar' });
    const callArgs = mockCtx.reply.mock.calls[0];
    expect(callArgs[0]).toBe('[object Object]');
  });

  it('should trim leading/trailing whitespace', async () => {
    await safeReply(mockCtx, '  mensaje con espacios  ');
    const callArgs = mockCtx.reply.mock.calls[0];
    expect(callArgs[0]).toBe('mensaje con espacios');
  });
});

describe('processWithAI — history handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRecentMessages.mockResolvedValue([]);
  });

  it('should load recent messages from conversations', async () => {
    mockGetRecentMessages.mockResolvedValue([
      { id: 1, user_id: 123, role: 'user', content: 'Hola', created_at: new Date().toISOString() },
      { id: 2, user_id: 123, role: 'assistant', content: '¿En qué puedo ayudarte?', created_at: new Date().toISOString() },
    ]);

    await processWithAI('Quiero añadir leche', 123);

    expect(mockGetRecentMessages).toHaveBeenCalledWith(123);
    expect(mockSaveMessage).toHaveBeenCalled();
  });

  it('should pass history to startChat', async () => {
    mockGetRecentMessages.mockResolvedValue([
      { id: 1, user_id: 123, role: 'user', content: 'Hola', created_at: new Date().toISOString() },
    ]);

    await processWithAI('Añade leche', 123);

    // Verify startChat was called with history containing the past message
    const startChatCall = mockStartChatFn.mock.calls[0]?.[0];
    expect(startChatCall).toBeDefined();
    expect(startChatCall.history).toBeDefined();
    expect(startChatCall.history.length).toBe(1);
    expect(startChatCall.history[0].role).toBe('user');
    expect(startChatCall.history[0].parts[0].text).toBe('Hola');
  });

  it('should save both user message and bot response', async () => {
    await processWithAI('Dime algo', 456);

    expect(mockSaveMessage).toHaveBeenCalledTimes(2);
    expect(mockSaveMessage).toHaveBeenCalledWith(456, 'user', 'Dime algo');
    expect(mockSaveMessage).toHaveBeenCalledWith(456, 'assistant', 'Respuesta de prueba');
  });

  it('should work with empty history', async () => {
    mockGetRecentMessages.mockResolvedValue([]);

    const result = await processWithAI('Hola', 789);

    expect(result).toBeTruthy();
    expect(mockSaveMessage).toHaveBeenCalled();
  });

  it('should not crash if history fails to load', async () => {
    mockGetRecentMessages.mockRejectedValue(new Error('DB error'));

    // Should still return gracefully
    const result = await processWithAI('Hola', 789);
    expect(result).toBeTruthy();
  });
});
