import { neon, NeonQueryFunction } from '@neondatabase/serverless';

let testSql: NeonQueryFunction<false, false> | null = null;

/**
 * Get a Neon connection for integration tests.
 * Uses DATABASE_URL_TEST from env, or skips if not configured.
 * Each test file should call ensureTestDb() in beforeAll and
 * clean up in afterAll.
 */
export function getTestSql(): NeonQueryFunction<false, false> {
  // Only use DATABASE_URL_TEST — never fall back to production DATABASE_URL
  const url = process.env['DATABASE_URL_TEST'];
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST not set. Create a Neon branch for testing:\n' +
      '  DATABASE_URL_TEST=postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require',
    );
  }
  if (!testSql) {
    testSql = neon(url);
  }
  return testSql;
}

/**
 * Initialize the test database schema (same as production).
 * Idempotent — safe to call multiple times.
 */
export async function initTestDb(): Promise<void> {
  const sql = getTestSql();

  // Drop all tables to ensure clean schema (idempotent — only runs once per test suite)
  await sql`DROP TABLE IF EXISTS movement_log CASCADE`;
  await sql`DROP TABLE IF EXISTS shopping_list CASCADE`;
  await sql`DROP TABLE IF EXISTS products CASCADE`;
  await sql`DROP TABLE IF EXISTS zones CASCADE`;

  // Recreate zones with INTEGER user_id (not BIGINT, which returns string from Neon)
  await sql`CREATE TABLE zones (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '📦',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

  // Create unique index for system zones (needed for ON CONFLICT DO NOTHING)
  await sql`
    CREATE UNIQUE INDEX idx_zones_name_system
    ON zones(name) WHERE user_id IS NULL
  `;

  // Insert default zones
  await sql`
    INSERT INTO zones (user_id, name, emoji)
    VALUES
      (NULL, 'nevera', '🧊'),
      (NULL, 'congelador', '❄️'),
      (NULL, 'armario_cocina', '🚪'),
      (NULL, 'despensa', '📦'),
      (NULL, 'otros', '📌')
  `;

  await sql`CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'ud' CHECK(unit IN ('ud', 'kg', 'L', 'g', 'ml')),
    zone TEXT NOT NULL CHECK(zone IN ('nevera', 'congelador', 'armario_cocina', 'despensa', 'otros')),
    zone_id INTEGER REFERENCES zones(id),
    min_stock REAL,
    expiration_date DATE,
    is_depleted INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

  await sql`CREATE TABLE shopping_list (
    id SERIAL PRIMARY KEY,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit TEXT NOT NULL DEFAULT 'ud' CHECK(unit IN ('ud', 'kg', 'L', 'g', 'ml')),
    is_checked INTEGER NOT NULL DEFAULT 0,
    added_by BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

  await sql`CREATE TABLE movement_log (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK(action IN ('added', 'consumed', 'moved', 'restocked', 'depleted')),
    previous_value TEXT,
    new_value TEXT,
    user_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

/**
 * Clean all test data between tests.
 * Truncates all tables and reseeds default zones.
 */
export async function cleanTestDb(): Promise<void> {
  const sql = getTestSql();
  // Delete in order that respects FK constraints
  await sql`DELETE FROM movement_log`;
  await sql`DELETE FROM shopping_list`;
  await sql`DELETE FROM products`;
  await sql`DELETE FROM zones WHERE user_id IS NOT NULL`;
  // Don't delete default zones — they're needed for FK references
}

/**
 * Check if DATABASE_URL_TEST is configured.
 */
export function hasTestDb(): boolean {
  return !!process.env['DATABASE_URL_TEST'];
}

/**
 * Get the ID of a default zone by name.
 * Returns 0 if test DB is not configured (caller should skip).
 */
export async function getDefaultZoneId(name: string): Promise<number> {
  if (!hasTestDb()) return 0;
  const sql = getTestSql();
  const rows = await sql`SELECT id FROM zones WHERE name = ${name} AND user_id IS NULL`;
  return (rows as any[])[0]?.id ?? 0;
}
