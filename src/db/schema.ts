import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { config } from '../utils/config';

let sql: NeonQueryFunction<false, false>;

export function getSql(): NeonQueryFunction<false, false> {
  if (!sql) {
    sql = neon(config.databaseUrl);
    initializeSchema();
  }
  return sql;
}

async function initializeSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'ud' CHECK(unit IN ('ud', 'kg', 'L', 'g', 'ml')),
      zone TEXT NOT NULL CHECK(zone IN ('nevera', 'congelador', 'armario_cocina', 'despensa', 'otros')),
      min_stock REAL,
      expiration_date DATE,
      is_depleted INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shopping_list (
      id SERIAL PRIMARY KEY,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT 'ud' CHECK(unit IN ('ud', 'kg', 'L', 'g', 'ml')),
      is_checked INTEGER NOT NULL DEFAULT 0,
      added_by BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS movement_log (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK(action IN ('added', 'consumed', 'moved', 'restocked', 'depleted')),
      previous_value TEXT,
      new_value TEXT,
      user_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_products_zone ON products(zone);
    CREATE INDEX IF NOT EXISTS idx_products_expiration ON products(expiration_date);
    CREATE INDEX IF NOT EXISTS idx_shopping_list_checked ON shopping_list(is_checked);
    CREATE INDEX IF NOT EXISTS idx_movement_log_product ON movement_log(product_id);
  `;
}
