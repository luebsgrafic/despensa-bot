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

export async function getTopConsumed(
  days: number,
  limit = 3,
): Promise<{ product_id: number; product_name: string; count: number }[]> {
  const sql = getSql();
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - days);

  const rows = await sql`
    SELECT ml.product_id, p.name as product_name, CAST(COUNT(*) AS INTEGER) as count
    FROM movement_log ml
    JOIN products p ON ml.product_id = p.id
    WHERE ml.action = 'consumed'
      AND ml.created_at >= ${threshold.toISOString()}::timestamptz
    GROUP BY ml.product_id, p.name
    ORDER BY count DESC
    LIMIT ${limit}
  ` as unknown as any[];
  return rows as { product_id: number; product_name: string; count: number }[];
}
