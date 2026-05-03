import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { config } from '../utils/config';

let sql: NeonQueryFunction<false, false>;
let schemaInitialized = false;

export function getSql(): NeonQueryFunction<false, false> {
  if (!sql) {
    sql = neon(config.databaseUrl);
  }
  return sql;
}

export async function initializeSchema(): Promise<void> {
  if (schemaInitialized) return;
  schemaInitialized = true;

  sql = sql || neon(config.databaseUrl);
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
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS shopping_list (
      id SERIAL PRIMARY KEY,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT 'ud' CHECK(unit IN ('ud', 'kg', 'L', 'g', 'ml')),
      is_checked INTEGER NOT NULL DEFAULT 0,
      added_by BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS movement_log (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK(action IN ('added', 'consumed', 'moved', 'restocked', 'depleted')),
      previous_value TEXT,
      new_value TEXT,
      user_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // ── Zones table (customizable zones per user) ──────────
  await sql`
    CREATE TABLE IF NOT EXISTS zones (
      id SERIAL PRIMARY KEY,
      user_id BIGINT,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📦',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // ── Add zone_id to products (nullable, FK) ────────────
  await sql`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id)
  `;

  // ── Create default zones (idempotent) ──────────────────
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

  // ── Migrate existing products: zone (text) → zone_id (FK) ──
  await sql`
    UPDATE products p
    SET zone_id = (SELECT id FROM zones WHERE name = p.zone AND user_id IS NULL)
    WHERE p.zone_id IS NULL AND p.zone IS NOT NULL
  `;

  // ── Indexes ────────────────────────────────────────────
  await sql`
    CREATE INDEX IF NOT EXISTS idx_products_zone ON products(zone)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_products_zone_id ON products(zone_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_products_expiration ON products(expiration_date)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_shopping_list_checked ON shopping_list(is_checked)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_movement_log_product ON movement_log(product_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_zones_user_id ON zones(user_id)
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_zones_name_system ON zones(name) WHERE user_id IS NULL
  `;
}
