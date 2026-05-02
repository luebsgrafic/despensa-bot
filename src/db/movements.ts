import { getSql } from './schema';
import { MovementLog } from '../types';

export async function logMovement(
  productId: number,
  action: MovementLog['action'],
  previousValue: string | null,
  newValue: string | null,
  userId: number,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO movement_log (product_id, action, previous_value, new_value, user_id)
    VALUES (${productId}, ${action}, ${previousValue}, ${newValue}, ${userId})
  `;
}

export async function getMovementsByProduct(
  productId: number,
  limit = 20,
): Promise<MovementLog[]> {
  const sql = getSql();
  return sql`
    SELECT * FROM movement_log
    WHERE product_id = ${productId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  ` as unknown as MovementLog[];
}

export async function getRecentMovements(limit = 50): Promise<MovementLog[]> {
  const sql = getSql();
  return sql`
    SELECT * FROM movement_log ORDER BY created_at DESC LIMIT ${limit}
  ` as unknown as MovementLog[];
}
