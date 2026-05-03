import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTranscribeAndProcessAudio = vi.fn();
const mockSafeReply = vi.fn();

vi.mock('../src/services/gemini', () => ({
  transcribeAndProcessAudio: (...args: any[]) => mockTranscribeAndProcessAudio(...args),
  safeReply: (...args: any[]) => mockSafeReply(...args),
}));

import { handleVoiceMessage } from '../src/handlers/voice';

function createVoiceCtx(overrides: Record<string, any> = {}): any {
  return {
    message: {
      voice: {
        file_id: 'test_file_id',
        mime_type: 'audio/ogg',
        duration: 3,
      },
    },
    from: { id: 12345 },
    chat: { id: 12345 },
    telegram: {
      getFileLink: vi.fn().mockResolvedValue({ href: 'https://example.com/audio.ogg' }),
    },
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('Voice Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
    });
  });

  it('should transcribe audio and show transcription + result', async () => {
    const ctx = createVoiceCtx();
    mockTranscribeAndProcessAudio.mockResolvedValue({
      transcription: 'añade 2 litros de leche a la nevera',
      response: '🎤 Escuché: "añade 2 litros de leche a la nevera"\n\n✅ He añadido Leche (2L) a la despensa en 🧊 nevera.',
    });

    await handleVoiceMessage(ctx);

    expect(ctx.telegram.getFileLink).toHaveBeenCalledWith('test_file_id');
    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/audio.ogg');
    expect(mockTranscribeAndProcessAudio).toHaveBeenCalledOnce();
    expect(mockSafeReply).toHaveBeenCalled();
    const replyText = mockSafeReply.mock.calls[0][1];
    expect(replyText).toContain('añade 2 litros de leche');
    expect(replyText).toContain('He añadido');
  });

  it('should handle Gemini returning invalid JSON gracefully', async () => {
    const ctx = createVoiceCtx();
    mockTranscribeAndProcessAudio.mockResolvedValue({
      transcription: '',
      response: '🤖 No entendí el audio. Intenta escribirlo.',
    });

    await handleVoiceMessage(ctx);

    expect(mockSafeReply).toHaveBeenCalled();
    const replyText = mockSafeReply.mock.calls[0][1];
    expect(replyText).toContain('No entendí');
  });

  it('should handle network errors gracefully', async () => {
    const ctx = createVoiceCtx();
    mockTranscribeAndProcessAudio.mockRejectedValue(new Error('Network error'));

    await handleVoiceMessage(ctx);

    expect(mockSafeReply).toHaveBeenCalled();
    const replyText = mockSafeReply.mock.calls[0][1];
    expect(replyText).toContain('error');
  });

  it('should handle download failures gracefully', async () => {
    const ctx = createVoiceCtx();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
    });

    await handleVoiceMessage(ctx);

    expect(mockSafeReply).toHaveBeenCalled();
    const replyText = mockSafeReply.mock.calls[0][1];
    expect(replyText).toContain('No pude descargar');
  });

  it('should not crash when message has no voice', async () => {
    const ctx = createVoiceCtx({ message: { text: 'hello' } });

    await handleVoiceMessage(ctx);

    expect(mockSafeReply).not.toHaveBeenCalled();
  });
});
