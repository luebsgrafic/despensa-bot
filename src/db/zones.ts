import { getSql } from './schema';
import { Zone } from '../types';

/**
 * Normalize a zone row: ensure user_id is a number (not string from PG).
 */
function normalizeZone(z: any): Zone {
  if (!z) return z;
  return {
    ...z,
    user_id: z.user_id !== null && z.user_id !== undefined ? Number(z.user_id) : null,
  };
}

function normalizeZones(rows: any[]): Zone[] {
  return (rows as Zone[]).map(normalizeZone);
}

export async function getZonesByUser(userId: number): Promise<Zone[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM zones
    WHERE user_id IS NULL OR user_id = ${userId}
    ORDER BY user_id NULLS FIRST, name
  `;
  return normalizeZones(rows as any[]);
}

export async function createZone(
  userId: number,
  name: string,
  emoji?: string,
): Promise<Zone> {
  const sql = getSql();

  // Check for duplicate name — only for the same user
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
  return normalizeZone((rows as any[])[0]);
}

export async function renameZone(
  zoneId: number,
  userId: number,
  newName: string,
): Promise<Zone> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM zones WHERE id = ${zoneId}`;
  const zone = normalizeZone((rows as any[])[0]);

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
  return normalizeZone((updated as any[])[0]);
}

export async function deleteZone(
  zoneId: number,
  userId: number,
): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM zones WHERE id = ${zoneId}`;
  const zone = normalizeZone((rows as any[])[0]);

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

  const result = await sql`DELETE FROM zones WHERE id = ${zoneId} RETURNING id`;
  return (result as any[]).length > 0;
}

export async function getDefaultZones(): Promise<Zone[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM zones WHERE user_id IS NULL ORDER BY id
  `;
  return normalizeZones(rows as any[]);
}

export async function ensureDefaultZones(): Promise<void> {
  const sql = getSql();
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
  const zone = (rows as any[])[0];
  return zone ? normalizeZone(zone) : undefined;
}
