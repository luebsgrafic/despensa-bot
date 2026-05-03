import { getSql } from './schema';
import { Zone } from '../types';

export async function getZonesByUser(userId: number): Promise<Zone[]> {
  const sql = getSql();
  return sql`
    SELECT * FROM zones
    WHERE user_id IS NULL OR user_id = ${userId}
    ORDER BY user_id NULLS FIRST, name
  ` as unknown as Zone[];
}

export async function createZone(
  userId: number,
  name: string,
  emoji?: string,
): Promise<Zone> {
  const sql = getSql();

  // Check for duplicate name — only for the same user or system zones
  const existing = await sql`
    SELECT id FROM zones
    WHERE user_id = ${userId}
      AND LOWER(name) = LOWER(${name})
  `;

  if ((existing as any[]).length > 0) {
    throw new Error('ZONE_EXISTS');
  }

  const rows = await sql`
    INSERT INTO zones (user_id, name, emoji)
    VALUES (${userId}, ${name}, ${emoji ?? '📦'})
    RETURNING *
  `;
  return (rows as unknown as Zone[])[0];
}

export async function renameZone(
  zoneId: number,
  userId: number,
  newName: string,
): Promise<Zone> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM zones WHERE id = ${zoneId}`;
  const zone = (rows as unknown as Zone[])[0];

  if (!zone) {
    throw new Error('NOT_FOUND');
  }

  // Only the owner can rename (system zones can be renamed by anyone for now)
  if (zone.user_id !== null && zone.user_id !== userId) {
    throw new Error('FORBIDDEN');
  }

  // Check for duplicate name
  const existing = await sql`
    SELECT id FROM zones
    WHERE (user_id IS NULL OR user_id = ${userId})
      AND LOWER(name) = LOWER(${newName})
      AND id != ${zoneId}
  `;

  if ((existing as any[]).length > 0) {
    throw new Error('ZONE_EXISTS');
  }

  const updated = await sql`
    UPDATE zones SET name = ${newName} WHERE id = ${zoneId} RETURNING *
  `;
  return (updated as unknown as Zone[])[0];
}

export async function deleteZone(
  zoneId: number,
  userId: number,
): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM zones WHERE id = ${zoneId}`;
  const zone = (rows as unknown as Zone[])[0];

  if (!zone) {
    throw new Error('NOT_FOUND');
  }

  // Only the owner can delete
  if (zone.user_id !== null && zone.user_id !== userId) {
    throw new Error('FORBIDDEN');
  }

  // Check if zone has products
  const productCount = await sql`
    SELECT COUNT(*) as count FROM products WHERE zone_id = ${zoneId}
  `;
  const count = (productCount as any[])[0]?.count ?? 0;

  if (count > 0) {
    throw new Error('ZONE_NOT_EMPTY');
  }

  const result = await sql`DELETE FROM zones WHERE id = ${zoneId}`;
  return (result as any).count > 0;
}

export async function getDefaultZones(): Promise<Zone[]> {
  const sql = getSql();
  return sql`
    SELECT * FROM zones WHERE user_id IS NULL ORDER BY id
  ` as unknown as Zone[];
}

export async function ensureDefaultZones(): Promise<void> {
  const sql = getSql();
  // Idempotent insert — the ON CONFLICT DO NOTHING in schema.ts handles this,
  // but this function provides an explicit API for it
  await sql`
    INSERT INTO zones (user_id, name, emoji)
    VALUES
      (NULL, 'nevera', '🧊'),
      (NULL, 'congelador', '❄️'),
      (NULL, 'armario_cocina', '🚪'),
      (NULL, 'despensa', '📦'),
      (NULL, 'otros', '📌')
    ON CONFLICT DO NOTHING
  `;
}

export async function getZoneById(zoneId: number): Promise<Zone | undefined> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM zones WHERE id = ${zoneId}`;
  return (rows as unknown as Zone[])[0];
}
