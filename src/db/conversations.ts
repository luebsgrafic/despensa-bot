import { getSql } from './schema';

const MAX_MESSAGES_PER_USER = 20;

export interface ConversationMessage {
  id: number;
  user_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export async function getRecentMessages(
  userId: number,
  limit = 10,
): Promise<ConversationMessage[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM (
      SELECT * FROM conversations
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    ) sub
    ORDER BY created_at ASC
  `;
  return rows as unknown as ConversationMessage[];
}

export async function saveMessage(
  userId: number,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO conversations (user_id, role, content)
    VALUES (${userId}, ${role}, ${content})
  `;

  // Keep only the newest MAX_MESSAGES_PER_USER messages for this user
  await sql`
    DELETE FROM conversations
    WHERE user_id = ${userId}
      AND id NOT IN (
        SELECT id FROM conversations
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${MAX_MESSAGES_PER_USER}
      )
  `;
}
