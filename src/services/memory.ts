import { config } from '../utils/config';

// mem0ai uses a dynamic import or requires API key at runtime
// We keep it optional — if MEM0_API_KEY is not set, memory functions are no-ops

let memoryClient: any = null;

async function getClient(): Promise<any> {
  if (memoryClient) return memoryClient;

  const apiKey = process.env['MEM0_API_KEY'] || config.mem0ApiKey;
  if (!apiKey) return null;

  try {
    const { MemoryClient } = await import('mem0ai');
    memoryClient = new MemoryClient({ apiKey });
    return memoryClient;
  } catch (err) {
    console.warn('[Memory] Failed to initialize mem0 client:', err);
    return null;
  }
}

/**
 * Add messages to mem0 memory for a user.
 * Never throws — logs warning on failure.
 */
export async function addToMemory(
  userId: number,
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  try {
    const client = await getClient();
    if (!client) return;

    await client.add(messages, { user_id: String(userId) });
  } catch (err: any) {
    console.warn('[Memory] Failed to add to memory:', err?.message || err);
  }
}

/**
 * Search mem0 for relevant memories about a user.
 * Returns a string of memories, or empty string on failure.
 */
export async function getRelevantMemories(
  userId: number,
  query: string,
): Promise<string> {
  try {
    const client = await getClient();
    if (!client) return '';

    const results = await client.search(query, { user_id: String(userId) });
    if (!results || !Array.isArray(results) || results.length === 0) return '';

    return results.map((r: any) => r.memory).join('\n');
  } catch (err: any) {
    console.warn('[Memory] Failed to search memories:', err?.message || err);
    return '';
  }
}
