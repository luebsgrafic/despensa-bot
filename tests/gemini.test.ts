import { describe, it, expect, vi, beforeEach } from 'vitest';

import { safeReply } from '../src/services/gemini';

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
