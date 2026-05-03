import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMem0Add = vi.fn();
const mockMem0Search = vi.fn();

vi.mock('mem0ai', () => ({
  MemoryClient: class {
    add(...args: any[]) { return mockMem0Add(...args) }
    search(...args: any[]) { return mockMem0Search(...args) }
  },
}));

vi.mock('../src/utils/config', () => ({
  config: {
    mem0ApiKey: 'test-key',
  },
}));

import { addToMemory, getRelevantMemories } from '../src/services/memory';

describe('Memory service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should add messages to memory', async () => {
    mockMem0Add.mockResolvedValue(undefined);

    await addToMemory(123, [
      { role: 'user', content: 'Hola' },
      { role: 'assistant', content: '¿En qué ayudarte?' },
    ]);

    expect(mockMem0Add).toHaveBeenCalledWith(
      [
        { role: 'user', content: 'Hola' },
        { role: 'assistant', content: '¿En qué ayudarte?' },
      ],
      { user_id: '123' },
    );
  });

  it('should search relevant memories', async () => {
    mockMem0Search.mockResolvedValue([
      { memory: 'No le gusta el pescado' },
      { memory: 'Compra en Mercadona los jueves' },
    ]);

    const result = await getRelevantMemories(123, 'preferencias');

    expect(result).toContain('No le gusta el pescado');
    expect(result).toContain('Compra en Mercadona');
  });

  it('should return empty string when no memories found', async () => {
    mockMem0Search.mockResolvedValue([]);

    const result = await getRelevantMemories(123, 'algo');
    expect(result).toBe('');
  });

  it('should not throw when mem0 add fails', async () => {
    mockMem0Add.mockRejectedValue(new Error('API error'));

    await expect(
      addToMemory(123, [{ role: 'user', content: 'test' }]),
    ).resolves.toBeUndefined();
  });

  it('should return empty string when mem0 search fails', async () => {
    mockMem0Search.mockRejectedValue(new Error('Network error'));

    const result = await getRelevantMemories(123, 'test');
    expect(result).toBe('');
  });
});
