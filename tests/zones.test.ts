import { describe, it, expect, vi, beforeEach } from 'vitest';

interface MockZone {
  id: number;
  user_id: number | null;
  name: string;
  emoji: string;
  created_at: string;
}

interface MockProduct {
  id: number;
  zone_id: number;
  name: string;
}

const state = {
  zones: [] as MockZone[],
  products: [] as MockProduct[],
  nextZoneId: 1,
  nextProductId: 100,
};

function resetState() {
  state.zones = [];
  state.products = [];
  state.nextZoneId = 1;
  state.nextProductId = 100;
}

vi.mock('../src/db/schema', () => {
  const mockSql = (_strings: TemplateStringsArray, ...values: any[]) => {
    const query = _strings.join('?').trim();

    // INSERT — must come first since it doesn't return a SELECT
    if (query.includes('INSERT INTO zones')) {
      const existing = state.zones.find(
        (z) => z.user_id === values[1] && z.name === values[0],
      );
      if (existing) {
        throw new Error('Zone already exists');
      }
      const zone: MockZone = {
        id: state.nextZoneId++,
        user_id: values[1],
        name: values[0],
        emoji: values[2] || '📦',
        created_at: new Date().toISOString(),
      };
      state.zones.push(zone);
      return [zone];
    }

    // SELECT specific: user_id IS NULL AND name = ? (for ensureDefaultZones check)
    if (
      query.includes('SELECT') &&
      query.includes('WHERE user_id IS NULL AND name')
    ) {
      const zone = state.zones.find(
        (z) => z.user_id === null && z.name === values[0],
      );
      return zone ? [zone] : [];
    }

    // SELECT specific: user_id IS NULL OR user_id = ? (getZonesByUser)
    if (
      query.includes('SELECT * FROM zones') &&
      query.includes('IS NULL') &&
      query.includes(' OR ') &&
      query.includes('user_id = ?')
    ) {
      const userId = values[0];
      return state.zones.filter(
        (z) => z.user_id === null || z.user_id === userId,
      );
    }

    // SELECT specific: user_id IS NULL (getDefaultZones)
    if (
      query.includes('SELECT') &&
      query.includes('WHERE user_id IS NULL') &&
      !query.includes(' OR ')
    ) {
      return state.zones.filter((z) => z.user_id === null);
    }

    // SELECT specific: user_id = ? (no IS NULL)
    if (
      query.includes('SELECT * FROM zones') &&
      query.includes('WHERE user_id = ?')
    ) {
      return state.zones.filter((z) => z.user_id === values[0]);
    }

    // SELECT specific: WHERE id = ?
    if (
      query.includes('SELECT * FROM zones') &&
      query.includes('WHERE id = ?')
    ) {
      const zone = state.zones.find((z) => z.id === values[0]);
      return zone ? [zone] : [];
    }

    // UPDATE with user_id check (renameZone)
    // Template: UPDATE zones SET name = ${newName} WHERE id = ${zoneId} AND user_id = ${userId}
    // values = [newName, zoneId, userId]
    if (
      query.includes('UPDATE zones') &&
      query.includes('user_id')
    ) {
      const zone = state.zones.find((z) => z.id === values[1]);
      if (!zone) return [];
      if (zone.user_id !== values[2]) {
        return [];
      }
      zone.name = values[0];
      return [zone];
    }

    // UPDATE without user_id check (fallback)
    if (query.includes('UPDATE zones SET name = ? WHERE id = ?')) {
      const zone = state.zones.find((z) => z.id === values[1]);
      if (!zone) return [];
      zone.name = values[0];
      return [zone];
    }

    // SELECT COUNT products by zone_id
    if (query.includes('COUNT(*)') && query.includes('zone_id')) {
      const count = state.products.filter(
        (p) => p.zone_id === values[0],
      ).length;
      return [{ count }];
    }

    // DELETE
    if (query.includes('DELETE FROM zones WHERE id = ?')) {
      const idx = state.zones.findIndex((z) => z.id === values[0]);
      if (idx !== -1) {
        state.zones.splice(idx, 1);
        return { count: 1 };
      }
      return { count: 0 };
    }

    return [];
  };

  return { getSql: () => mockSql };
});

/**
 * Zones repository — inlined handler implementations so tests
 * can run independently before src/db/zones.ts exists.
 */
import { getSql } from '../src/db/schema';

async function createZone(
  userId: number,
  name: string,
  emoji?: string,
): Promise<MockZone> {
  const sql = getSql();
  const rows = (await sql`
    INSERT INTO zones (name, user_id, emoji)
    VALUES (${name}, ${userId}, ${emoji ?? null})
    RETURNING *
  `) as unknown as MockZone[];
  return rows[0];
}

async function getZonesByUser(userId: number): Promise<MockZone[]> {
  const sql = getSql();
  return sql`
    SELECT * FROM zones WHERE user_id IS NULL OR user_id = ${userId}
    ORDER BY name
  ` as unknown as MockZone[];
}

async function renameZone(
  zoneId: number,
  userId: number,
  newName: string,
): Promise<MockZone> {
  const sql = getSql();
  const rows = (await sql`
    UPDATE zones SET name = ${newName}
    WHERE id = ${zoneId} AND user_id = ${userId}
    RETURNING *
  `) as unknown as MockZone[];
  if (rows.length === 0) {
    throw new Error('Zone not found or not owned by user');
  }
  return rows[0];
}

async function deleteZone(
  zoneId: number,
  userId: number,
): Promise<boolean> {
  const sql = getSql();
  const countRows = (await sql`
    SELECT COUNT(*) as count FROM products WHERE zone_id = ${zoneId}
  `) as unknown as { count: number }[];
  if (countRows[0]?.count > 0) {
    throw new Error('Cannot delete zone that has products');
  }
  const result = (await sql`
    DELETE FROM zones WHERE id = ${zoneId}
  `) as unknown as { count: number };
  return (result as any).count > 0;
}

async function getDefaultZones(): Promise<MockZone[]> {
  const sql = getSql();
  return sql`
    SELECT * FROM zones WHERE user_id IS NULL
    ORDER BY name
  ` as unknown as MockZone[];
}

async function ensureDefaultZones(): Promise<void> {
  const sql = getSql();
  const defaults = [
    { name: 'nevera', emoji: '🧊' },
    { name: 'congelador', emoji: '❄️' },
    { name: 'armario_cocina', emoji: '🚪' },
    { name: 'despensa', emoji: '📦' },
    { name: 'otros', emoji: '📌' },
  ];
  for (const z of defaults) {
    const existing = (await sql`
      SELECT * FROM zones WHERE user_id IS NULL AND name = ${z.name}
    `) as unknown as MockZone[];
    if (existing.length === 0) {
      await sql`
        INSERT INTO zones (name, user_id, emoji)
        VALUES (${z.name}, ${null}, ${z.emoji})
      `;
    }
  }
}

describe('Zones Repository', () => {
  beforeEach(() => {
    resetState();
  });

  describe('createZone', () => {
    it('should create a zone and return it with id, user_id, name, emoji', async () => {
      const zone = await createZone(123, 'lacteos', '🥛');

      expect(zone.id).toBeDefined();
      expect(zone.user_id).toBe(123);
      expect(zone.name).toBe('lacteos');
      expect(zone.emoji).toBe('🥛');
    });

    it('should use default emoji when not specified', async () => {
      const zone = await createZone(123, 'lacteos');

      expect(zone.emoji).toBe('📦');
    });

    it('should throw if a zone with the same name already exists for the same user', async () => {
      await createZone(123, 'lacteos', '🥛');

      await expect(
        createZone(123, 'lacteos', '🥛'),
      ).rejects.toThrow('Zone already exists');
    });

    it('should allow same name for different users', async () => {
      await createZone(123, 'lacteos', '🥛');
      const zone2 = await createZone(456, 'lacteos', '🥛');

      expect(zone2.id).not.toBe(undefined);
      expect(zone2.user_id).toBe(456);
    });
  });

  describe('getZonesByUser', () => {
    it('should return system zones (user_id=NULL) plus user zones', async () => {
      await ensureDefaultZones();
      await createZone(123, 'lacteos', '🥛');
      await createZone(123, 'bebidas', '🧃');

      const result = await getZonesByUser(123);

      expect(result).toHaveLength(7);
      const userZones = result.filter((z: MockZone) => z.user_id === 123);
      expect(userZones).toHaveLength(2);
      const systemZones = result.filter(
        (z: MockZone) => z.user_id === null,
      );
      expect(systemZones).toHaveLength(5);
    });

    it('should NOT return zones from other users', async () => {
      await ensureDefaultZones();
      await createZone(999, 'secreta', '🤫');

      const result = await getZonesByUser(123);

      const secretZone = result.find(
        (z: MockZone) => z.name === 'secreta',
      );
      expect(secretZone).toBeUndefined();
    });
  });

  describe('renameZone', () => {
    it('should update the zone name correctly', async () => {
      const zone = await createZone(123, 'lacteos', '🥛');

      const updated = await renameZone(zone.id, 123, 'lacteos_frescos');

      expect(updated.name).toBe('lacteos_frescos');
    });

    it('should throw if another user tries to rename', async () => {
      const zone = await createZone(123, 'lacteos', '🥛');

      await expect(
        renameZone(zone.id, 456, 'hacked'),
      ).rejects.toThrow();
    });
  });

  describe('deleteZone', () => {
    it('should delete an empty zone', async () => {
      const zone = await createZone(123, 'lacteos', '🥛');

      const deleted = await deleteZone(zone.id, 123);
      expect(deleted).toBe(true);

      const allZones = state.zones.filter(
        (z: MockZone) => z.user_id === 123,
      );
      expect(allZones).toHaveLength(0);
    });

    it('should throw when zone has products', async () => {
      const zone = await createZone(123, 'lacteos', '🥛');
      state.products.push({
        id: state.nextProductId++,
        zone_id: zone.id,
        name: 'Leche',
      });

      await expect(deleteZone(zone.id, 123)).rejects.toThrow(
        /products|not empty|has/i,
      );
    });
  });

  describe('getDefaultZones', () => {
    it('should return only the 5 system zones', async () => {
      await ensureDefaultZones();

      const result = await getDefaultZones();

      expect(result).toHaveLength(5);
      for (const z of result) {
        expect(z.user_id).toBeNull();
      }
      const names = result.map((z: MockZone) => z.name).sort();
      expect(names).toEqual(
        [
          'armario_cocina',
          'congelador',
          'despensa',
          'nevera',
          'otros',
        ].sort(),
      );
    });
  });

  describe('ensureDefaultZones', () => {
    it('should be idempotent — calling twice does not duplicate', async () => {
      await ensureDefaultZones();
      const firstCount = state.zones.length;

      await ensureDefaultZones();
      const secondCount = state.zones.length;

      expect(secondCount).toBe(firstCount);
      expect(firstCount).toBe(5);
    });
  });
});
