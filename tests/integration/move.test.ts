import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestSql, initTestDb, cleanTestDb, getDefaultZoneId } from '../helpers/db';
import { products, movements, zones } from '../../src/db';

describe('Move product integration test', () => {
  beforeAll(async () => {
    // Skip if DATABASE_URL_TEST is not set
    if (!process.env['DATABASE_URL_TEST']) {
      console.warn('⚠️  DATABASE_URL_TEST not set — skipping integration tests');
      return;
    }
    await initTestDb();
  });

  beforeEach(async () => {
    if (!process.env['DATABASE_URL_TEST']) return;
    await cleanTestDb();
  });

  it('should move a product from nevera to congelador and persist in DB', async () => {
    if (!process.env['DATABASE_URL_TEST']) return;

    const neveraId = await getDefaultZoneId('nevera');
    const congeladorId = await getDefaultZoneId('congelador');

    // Create a product in nevera
    const product = await products.createProduct({
      name: 'Pollo',
      quantity: 2,
      unit: 'kg',
      zone: 'nevera',
      zone_id: neveraId,
    });

    expect(product.zone).toBe('nevera');
    expect(product.zone_id).toBe(neveraId);

    // Move to congelador
    const updated = await products.updateProduct(product.id, { zone_id: congeladorId });

    // Verify the update returned correctly
    expect(updated).toBeDefined();
    expect(updated!.zone_id).toBe(congeladorId);
    expect(updated!.zone).toBe('congelador'); // legacy column synced!

    // Verify directly in DB
    const sql = getTestSql();
    const rows = await sql`
      SELECT p.*, z.name as zone_name, z.emoji as zone_emoji
      FROM products p
      LEFT JOIN zones z ON p.zone_id = z.id
      WHERE p.id = ${product.id}
    `;
    const dbProduct = (rows as any[])[0];

    expect(dbProduct.zone_id).toBe(congeladorId);
    expect(dbProduct.zone).toBe('congelador'); // legacy column
    expect(dbProduct.zone_name).toBe('congelador'); // from JOIN
    expect(dbProduct.zone_emoji).toBe('❄️'); // from JOIN

    // Verify movement was logged
    const movements_result = await movements.getMovementsByProduct(product.id);
    const moveLog = movements_result.find((m) => m.action === 'moved');
    expect(moveLog).toBeDefined();
    expect(moveLog!.previous_value).toContain('nevera');
    expect(moveLog!.new_value).toContain('congelador');
  });

  it('should show correct zone in getProductById after move', async () => {
    if (!process.env['DATABASE_URL_TEST']) return;

    const neveraId = await getDefaultZoneId('nevera');
    const congeladorId = await getDefaultZoneId('congelador');

    const product = await products.createProduct({
      name: 'Helado',
      quantity: 3,
      unit: 'ud',
      zone: 'nevera',
      zone_id: neveraId,
    });

    await products.updateProduct(product.id, { zone_id: congeladorId });

    // Read back via getProductById (uses JOIN)
    const fetched = await products.getProductById(product.id);
    expect(fetched).toBeDefined();
    expect(fetched!.zone_id).toBe(congeladorId);
    expect(fetched!.zone_name).toBe('congelador');
    expect(fetched!.zone_emoji).toBe('❄️');
  });

  it('should list product in the correct zone after move', async () => {
    if (!process.env['DATABASE_URL_TEST']) return;

    const neveraId = await getDefaultZoneId('nevera');
    const congeladorId = await getDefaultZoneId('congelador');

    const product = await products.createProduct({
      name: 'Pescado',
      quantity: 1,
      unit: 'kg',
      zone: 'nevera',
      zone_id: neveraId,
    });

    // Move to congelador
    await products.updateProduct(product.id, { zone_id: congeladorId });

    // Should NOT appear in nevera
    const neveraProducts = await products.getProductsByZone('nevera');
    expect(neveraProducts.find((p) => p.id === product.id)).toBeUndefined();

    // Should appear in congelador (via legacy zone column)
    const congeladorProducts = await products.getProductsByZone('congelador');
    expect(congeladorProducts.find((p) => p.id === product.id)).toBeDefined();
  });
});
