import { getSql } from './schema';
import { ShoppingItem, ProductUnit } from '../types';

export interface AddShoppingItemInput {
  product_name: string;
  quantity: number;
  unit: ProductUnit;
  added_by: number;
}

export async function getAllShoppingItems(): Promise<ShoppingItem[]> {
  const sql = getSql();
  return sql`
    SELECT * FROM shopping_list ORDER BY is_checked, created_at DESC
  ` as unknown as ShoppingItem[];
}

export async function getUncheckedItems(): Promise<ShoppingItem[]> {
  const sql = getSql();
  return sql`
    SELECT * FROM shopping_list WHERE is_checked = 0 ORDER BY created_at DESC
  ` as unknown as ShoppingItem[];
}

export async function addShoppingItem(
  input: AddShoppingItemInput,
): Promise<ShoppingItem> {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO shopping_list (product_name, quantity, unit, added_by)
    VALUES (${input.product_name}, ${input.quantity}, ${input.unit}, ${input.added_by})
    RETURNING *
  `;
  return (rows as unknown as ShoppingItem[])[0];
}

export async function toggleShoppingItem(
  id: number,
): Promise<ShoppingItem | undefined> {
  const sql = getSql();
  const item = await sql`SELECT * FROM shopping_list WHERE id = ${id}`;
  const existing = (item as unknown as ShoppingItem[])[0];
  if (!existing) return undefined;

  const rows = await sql`
    UPDATE shopping_list SET is_checked = ${existing.is_checked ? 0 : 1}
    WHERE id = ${id}
    RETURNING *
  `;
  return (rows as unknown as ShoppingItem[])[0];
}

export async function removeShoppingItem(id: number): Promise<boolean> {
  const sql = getSql();
  const result = await sql`DELETE FROM shopping_list WHERE id = ${id} RETURNING id`;
  return (result as any[]).length > 0;
}

export async function clearCheckedItems(): Promise<number> {
  const sql = getSql();
  const result = await sql`DELETE FROM shopping_list WHERE is_checked = 1 RETURNING id`;
  return (result as any[]).length;
}
