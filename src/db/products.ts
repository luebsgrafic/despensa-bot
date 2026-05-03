import { getSql } from './schema';
import { Product, StorageZone, ProductUnit } from '../types';

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

// Base SELECT that JOINs with zones to get zone_name and zone_emoji
const PRODUCT_SELECT = `
  SELECT p.*, z.name as zone_name, z.emoji as zone_emoji
  FROM products p
  LEFT JOIN zones z ON p.zone_id = z.id
`;

async function getZoneNameById(zoneId: number | null | undefined): Promise<string | null> {
  if (!zoneId) return null;
  const sql = getSql();
  const rows = await sql`SELECT name FROM zones WHERE id = ${zoneId}`;
  const zone = (rows as any[])[0];
  return zone?.name ?? null;
}

export async function getAllProducts(): Promise<Product[]> {
  const sql = getSql();
  return sql`
    ${PRODUCT_SELECT}
    ORDER BY COALESCE(z.name, p.zone), p.name
  ` as unknown as Product[];
}

export async function getProductsByZone(zone: StorageZone): Promise<Product[]> {
  const sql = getSql();
  return sql`
    ${PRODUCT_SELECT}
    WHERE p.zone = ${zone}
    ORDER BY p.name
  ` as unknown as Product[];
}

export async function getProductById(id: number): Promise<Product | undefined> {
  const sql = getSql();
  const rows = await sql`
    ${PRODUCT_SELECT}
    WHERE p.id = ${id}
  `;
  return (rows as unknown as Product[])[0];
}

export async function searchProducts(query: string): Promise<Product[]> {
  const sql = getSql();
  return sql`
    ${PRODUCT_SELECT}
    WHERE p.name ILIKE ${'%' + query + '%'}
    ORDER BY COALESCE(z.name, p.zone), p.name
  ` as unknown as Product[];
}

export async function createProduct(input: CreateProductInput): Promise<Product> {
  const sql = getSql();
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
  return (rows as unknown as Product[])[0];
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
  if (input.zone_id !== undefined && input.zone_id !== existing.zone_id) {
    const zoneName = await getZoneNameById(input.zone_id);
    if (zoneName) {
      zoneValue = zoneName as StorageZone;
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
  return (rows as unknown as Product[])[0];
}

export async function deleteProduct(id: number): Promise<boolean> {
  const sql = getSql();
  const result = await sql`DELETE FROM products WHERE id = ${id}`;
  return (result as any).count > 0;
}

export async function getExpiringProducts(days: number): Promise<Product[]> {
  const sql = getSql();
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + days);
  const thresholdStr = threshold.toISOString().split('T')[0];

  return sql`
    ${PRODUCT_SELECT}
    WHERE p.expiration_date IS NOT NULL
      AND p.expiration_date <= ${thresholdStr}::date
      AND p.expiration_date >= CURRENT_DATE
      AND p.is_depleted = 0
    ORDER BY p.expiration_date
  ` as unknown as Product[];
}

export async function getLowStockProducts(): Promise<Product[]> {
  const sql = getSql();
  return sql`
    ${PRODUCT_SELECT}
    WHERE p.min_stock IS NOT NULL
      AND p.quantity <= p.min_stock
      AND p.is_depleted = 0
    ORDER BY COALESCE(z.name, p.zone), p.name
  ` as unknown as Product[];
}

export async function getDepletedProducts(): Promise<Product[]> {
  const sql = getSql();
  return sql`
    ${PRODUCT_SELECT}
    WHERE p.is_depleted = 1
    ORDER BY COALESCE(z.name, p.zone), p.name
  ` as unknown as Product[];
}
