/**
 * Integration test setup.
 * Overrides DATABASE_URL with DATABASE_URL_TEST before any modules are loaded.
 * This ensures all src/db/ modules connect to the test database.
 */
const testUrl = process.env['DATABASE_URL_TEST'];
if (testUrl) {
  process.env['DATABASE_URL'] = testUrl;
}
