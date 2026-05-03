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

export async function getAllProducts(): Promise<Product[]> {
  const sql = getSql();
  return sql`SELECT * FROM products ORDER BY zone, name` as unknown as Product[];
}

export async function getProductsByZone(zone: StorageZone): Promise<Product[]> {
  const sql = getSql();
  return sql`SELECT * FROM products WHERE zone = ${zone} ORDER BY name` as unknown as Product[];
}

export async function getProductById(id: number): Promise<Product | undefined> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM products WHERE id = ${id}`;
  return (rows as unknown as Product[])[0];
}

export async function searchProducts(query: string): Promise<Product[]> {
  const sql = getSql();
  return sql`
    SELECT * FROM products
    WHERE name ILIKE ${'%' + query + '%'}
    ORDER BY zone, name
  ` as unknown as Product[];
}

export async function createProduct(input: CreateProductInput): Promise<Product> {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO products (name, quantity, unit, zone, min_stock, expiration_date, is_depleted)
    VALUES (
      ${input.name},
      ${input.quantity},
      ${input.unit},
      ${input.zone},
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

  const rows = await sql`
    UPDATE products SET
      name = ${input.name ?? existing.name},
      quantity = ${quantity},
      unit = ${input.unit ?? existing.unit},
      zone = ${input.zone ?? existing.zone},
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
    SELECT * FROM products
    WHERE expiration_date IS NOT NULL
      AND expiration_date <= ${thresholdStr}::date
      AND expiration_date >= CURRENT_DATE
      AND is_depleted = 0
    ORDER BY expiration_date
  ` as unknown as Product[];
}

export async function getLowStockProducts(): Promise<Product[]> {
  const sql = getSql();
  return sql`
    SELECT * FROM products
    WHERE min_stock IS NOT NULL
      AND quantity <= min_stock
      AND is_depleted = 0
    ORDER BY zone, name
  ` as unknown as Product[];
}

export async function getDepletedProducts(): Promise<Product[]> {
  const sql = getSql();
  return sql`
    SELECT * FROM products WHERE is_depleted = 1 ORDER BY zone, name
  ` as unknown as Product[];
}
