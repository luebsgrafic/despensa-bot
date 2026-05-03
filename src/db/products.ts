import { getSql } from './schema';
import { Product, StorageZone, ProductUnit } from '../types';
import { logMovement } from './movements';

export interface CreateProductInput {
  name: string;
  quantity: number;
  unit: ProductUnit;
  zone: StorageZone;
  zone_id?: number;
  min_stock?: number | null;
  expiration_date?: string | null;
}

export interface UpdateProductInput {
  quantity?: number;
  zone?: StorageZone;
  zone_id?: number;
  unit?: ProductUnit;
  min_stock?: number | null;
  expiration_date?: string | null;
  is_depleted?: boolean;
  name?: string;
}

/**
 * Enrich a product row with zone_name and zone_emoji from the zones table.
 * Uses a separate query instead of JOIN to avoid Neon tagged template limitations.
 */
async function enrichWithZone(product: any): Promise<any> {
  if (!product || !product.zone_id) return product;
  const sql = getSql();
  const rows = await sql`SELECT name, emoji FROM zones WHERE id = ${product.zone_id}`;
  const zone = (rows as any[])[0];
  if (zone) {
    product.zone_name = zone.name;
    product.zone_emoji = zone.emoji;
  }
  return product;
}

async function enrichAllWithZone(products: any[]): Promise<any[]> {
  return Promise.all(products.map(enrichWithZone));
}

/**
 * Format a date value from PostgreSQL (Date object or string) to YYYY-MM-DD string.
 */
function formatDateValue(date: any): string | null {
  if (!date) return null;
  if (typeof date === 'string') return date.split('T')[0];
  if (date instanceof Date) return date.toISOString().split('T')[0];
  return String(date);
}

/**
 * Normalize a product row: format dates, ensure correct types.
 */
function normalizeProduct(p: any): Product {
  return {
    ...p,
    expiration_date: formatDateValue(p.expiration_date),
    is_depleted: p.is_depleted === 1 || p.is_depleted === true ? 1 : 0,
    zone_id: p.zone_id ?? null,
    min_stock: p.min_stock ?? null,
  } as unknown as Product;
}

async function getZoneNameById(zoneId: number | null | undefined): Promise<string | null> {
  if (!zoneId) return null;
  const sql = getSql();
  const rows = await sql`SELECT name FROM zones WHERE id = ${zoneId}`;
  const zone = (rows as any[])[0];
  return zone?.name ?? null;
}

export async function getAllProducts(): Promise<Product[]> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM products ORDER BY zone, name` as unknown as any[];
  const enriched = await enrichAllWithZone(rows);
  return enriched.map(normalizeProduct);
}

export async function getProductsByZone(zone: StorageZone): Promise<Product[]> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM products WHERE zone = ${zone} ORDER BY name` as unknown as any[];
  const enriched = await enrichAllWithZone(rows);
  return enriched.map(normalizeProduct);
}

export async function getProductById(id: number): Promise<Product | undefined> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM products WHERE id = ${id}`;
  const product = (rows as unknown as any[])[0];
  if (!product) return undefined;
  const enriched = await enrichWithZone(product);
  return normalizeProduct(enriched);
}

export async function searchProducts(query: string): Promise<Product[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM products
    WHERE name ILIKE ${'%' + query + '%'}
    ORDER BY zone, name
  ` as unknown as any[];
  const enriched = await enrichAllWithZone(rows);
  return enriched.map(normalizeProduct);
}

export async function createProduct(input: CreateProductInput): Promise<Product> {
  const sql = getSql();

  // Upsert: check for existing product with same name (case insensitive) + zone_id + unit
  const existing = await sql`
    SELECT * FROM products
    WHERE LOWER(name) = LOWER(${input.name})
      AND zone_id IS NOT DISTINCT FROM ${input.zone_id ?? null}
      AND unit = ${input.unit}
    LIMIT 1
  `;
  const existingProduct = (existing as unknown as Product[])[0];

  if (existingProduct) {
    // Merge: add quantity to existing
    const newQuantity = existingProduct.quantity + input.quantity;
    const rows = await sql`
      UPDATE products SET
        quantity = ${newQuantity},
        unit = ${input.unit},
        is_depleted = ${newQuantity <= 0 ? 1 : 0},
        updated_at = NOW()
      WHERE id = ${existingProduct.id}
      RETURNING *
    `;
    const product = (rows as unknown as any[])[0];
    return normalizeProduct(product);
  }

  // No existing product — INSERT
  // Defensive: in case of concurrent access, a UNIQUE INDEX prevents duplicates.
  // If INSERT fails with unique violation (23505), fall back to update.
  try {
    const rows = await sql`
      INSERT INTO products (name, quantity, unit, zone, zone_id, min_stock, expiration_date, is_depleted)
      VALUES (
        ${input.name},
        ${input.quantity},
        ${input.unit},
        ${input.zone},
        ${input.zone_id ?? null},
        ${input.min_stock ?? null},
        ${input.expiration_date ?? null},
        ${input.quantity <= 0 ? 1 : 0}
      )
      RETURNING *
    `;
    const product = (rows as unknown as any[])[0];
    return normalizeProduct(product);
  } catch (error: any) {
    // PostgreSQL unique violation error code
    if (error?.code === '23505') {
      const retryExisting = await sql`
        SELECT * FROM products
        WHERE LOWER(name) = LOWER(${input.name})
          AND zone_id IS NOT DISTINCT FROM ${input.zone_id ?? null}
          AND unit = ${input.unit}
        LIMIT 1
      `;
      const retryProduct = (retryExisting as unknown as Product[])[0];
      if (retryProduct) {
        const newQuantity = retryProduct.quantity + input.quantity;
        const rows = await sql`
          UPDATE products SET
            quantity = ${newQuantity},
            unit = ${input.unit},
            is_depleted = ${newQuantity <= 0 ? 1 : 0},
            updated_at = NOW()
          WHERE id = ${retryProduct.id}
          RETURNING *
        `;
        const product = (rows as unknown as any[])[0];
        return normalizeProduct(product);
      }
    }
    throw error;
  }
}

export async function updateProduct(
  id: number,
  input: UpdateProductInput,
): Promise<Product | undefined> {
  const sql = getSql();
  const existing = await getProductById(id);
  if (!existing) return undefined;

  const quantity = input.quantity ?? existing.quantity;
  const isDepleted =
    input.is_depleted ?? (quantity <= 0 ? true : existing.is_depleted);

  // If zone_id is being updated, also sync the legacy zone column
  let zoneValue = input.zone ?? existing.zone;
  let oldZoneName: string | null = null;
  let newZoneName: string | null = null;
  const zoneChanged = input.zone_id !== undefined && input.zone_id !== existing.zone_id;

  if (zoneChanged) {
    const zoneName = await getZoneNameById(input.zone_id);
    if (zoneName) {
      zoneValue = zoneName as StorageZone;
      newZoneName = zoneName;
    }
    if (existing.zone_id) {
      const oldZone = await getZoneNameById(existing.zone_id);
      oldZoneName = oldZone;
    }
  }

  const rows = await sql`
    UPDATE products SET
      name = ${input.name ?? existing.name},
      quantity = ${quantity},
      unit = ${input.unit ?? existing.unit},
      zone = ${zoneValue},
      zone_id = ${input.zone_id !== undefined ? input.zone_id : existing.zone_id},
      min_stock = ${input.min_stock !== undefined ? input.min_stock : existing.min_stock},
      expiration_date = ${input.expiration_date !== undefined ? input.expiration_date : existing.expiration_date},
      is_depleted = ${isDepleted ? 1 : 0},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  const product = (rows as unknown as any[])[0];
  if (!product) return undefined;

  // Log movement when zone changes
  if (zoneChanged && newZoneName) {
    await logMovement(
      id,
      'moved',
      oldZoneName || 'desconocida',
      newZoneName,
      0,
    );
  }

  const enriched = await enrichWithZone(product);
  return normalizeProduct(enriched);
}

export async function deleteProduct(id: number): Promise<boolean> {
  const sql = getSql();
  const result = await sql`DELETE FROM products WHERE id = ${id} RETURNING id`;
  return (result as any[]).length > 0;
}

export async function getExpiringProducts(days: number): Promise<Product[]> {
  const sql = getSql();
  const todayStr = new Date().toISOString().split('T')[0];
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + days);
  const thresholdStr = threshold.toISOString().split('T')[0];

  const rows = await sql`
    SELECT * FROM products
    WHERE expiration_date IS NOT NULL
      AND expiration_date <> ''
      AND expiration_date >= ${todayStr}
      AND expiration_date <= ${thresholdStr}
      AND is_depleted = 0
    ORDER BY expiration_date
  ` as unknown as any[];
  const enriched = await enrichAllWithZone(rows);
  return enriched.map(normalizeProduct);
}

export async function getLowStockProducts(): Promise<Product[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM products
    WHERE min_stock IS NOT NULL
      AND quantity <= min_stock
      AND is_depleted = 0
    ORDER BY zone, name
  ` as unknown as any[];
  const enriched = await enrichAllWithZone(rows);
  return enriched.map(normalizeProduct);
}

export async function getDepletedProducts(): Promise<Product[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM products WHERE is_depleted = 1 ORDER BY zone, name
  ` as unknown as any[];
  const enriched = await enrichAllWithZone(rows);
  return enriched.map(normalizeProduct);
}

export async function getExpiredProducts(): Promise<Product[]> {
  const sql = getSql();
  const todayStr = new Date().toISOString().split('T')[0];

  const rows = await sql`
    SELECT * FROM products
    WHERE expiration_date IS NOT NULL
      AND expiration_date <> ''
      AND expiration_date < ${todayStr}
      AND is_depleted = 0
    ORDER BY expiration_date
  ` as unknown as any[];
  const enriched = await enrichAllWithZone(rows);
  return enriched.map(normalizeProduct);
}
