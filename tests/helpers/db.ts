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

  await sql`CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'ud' CHECK(unit IN ('ud', 'kg', 'L', 'g', 'ml')),
    zone TEXT NOT NULL CHECK(zone IN ('nevera', 'congelador', 'armario_cocina', 'despensa', 'otros')),
    zone_id INTEGER,
    min_stock REAL,
    expiration_date DATE,
    is_depleted INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS zones (
    id SERIAL PRIMARY KEY,
    user_id BIGINT,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '📦',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

  // Ensure default zones exist
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

/**
 * Clean all test data between tests.
 * Truncates all tables and reseeds default zones.
 */
export async function cleanTestDb(): Promise<void> {
  const sql = getTestSql();
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
