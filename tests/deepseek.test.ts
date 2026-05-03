import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import safeReply directly — it's a pure function that takes (ctx, text)
import { safeReply } from '../src/services/deepseek';

describe('processWithAI — empty response from DeepSeek', () => {
  it('safeReply should use fallback when message.content is empty (simulates reasoning_tokens=300, completion_tokens=300, content="")', async () => {
    const mockCtx = { reply: vi.fn().mockResolvedValue(undefined) };

    // Simulate: DeepSeek returns empty content because all tokens went to reasoning
    await safeReply(mockCtx, '');

    expect(mockCtx.reply).toHaveBeenCalledWith(
      'No he podido interpretar bien el mensaje. ¿Puedes decirme el producto, cantidad y zona? Ejemplo: añadir 2 kg de pollo en congelador.',
    );
    // Verify it was NOT called with empty string
    expect(mockCtx.reply).not.toHaveBeenCalledWith('');
  });
});

describe('safeReply', () => {
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = {
      reply: vi.fn().mockResolvedValue(undefined),
    };
    vi.clearAllMocks();
  });

  it('should call ctx.reply with normal text unchanged', async () => {
    await safeReply(mockCtx, 'Hola, esto es un mensaje normal');
    expect(mockCtx.reply).toHaveBeenCalledWith('Hola, esto es un mensaje normal');
  });

  it('should NOT call ctx.reply with empty string — use fallback instead', async () => {
    await safeReply(mockCtx, '');
    expect(mockCtx.reply).toHaveBeenCalledWith(
      'No he podido interpretar bien el mensaje. ¿Puedes decirme el producto, cantidad y zona? Ejemplo: añadir 2 kg de pollo en congelador.',
    );
  });

  it('should NOT call ctx.reply with undefined — use fallback instead', async () => {
    await safeReply(mockCtx, undefined);
    expect(mockCtx.reply).toHaveBeenCalledWith(
      'No he podido interpretar bien el mensaje. ¿Puedes decirme el producto, cantidad y zona? Ejemplo: añadir 2 kg de pollo en congelador.',
    );
  });

  it('should NOT call ctx.reply with null — use fallback instead', async () => {
    await safeReply(mockCtx, null);
    expect(mockCtx.reply).toHaveBeenCalledWith(
      'No he podido interpretar bien el mensaje. ¿Puedes decirme el producto, cantidad y zona? Ejemplo: añadir 2 kg de pollo en congelador.',
    );
  });

  it('should NOT call ctx.reply with whitespace-only string — use fallback instead', async () => {
    await safeReply(mockCtx, '   ');
    expect(mockCtx.reply).toHaveBeenCalledWith(
      'No he podido interpretar bien el mensaje. ¿Puedes decirme el producto, cantidad y zona? Ejemplo: añadir 2 kg de pollo en congelador.',
    );
  });

  it('should handle text with underscores like armario_cocina without Markdown errors', async () => {
    const text = 'El producto está en armario_cocina';
    await safeReply(mockCtx, text);
    expect(mockCtx.reply).toHaveBeenCalledWith(text);
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
    expect(mockCtx.reply).toHaveBeenCalledWith('42');
  });

  it('should convert object to string', async () => {
    await safeReply(mockCtx, { foo: 'bar' });
    expect(mockCtx.reply).toHaveBeenCalledWith('[object Object]');
  });

  it('should trim leading/trailing whitespace', async () => {
    await safeReply(mockCtx, '  mensaje con espacios  ');
    expect(mockCtx.reply).toHaveBeenCalledWith('mensaje con espacios');
  });
});
