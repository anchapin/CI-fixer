/**
 * Vitest Setup File
 * Configures environment for integration tests
 */

import { disconnectDb } from './db/client.js';

// Set DATABASE_URL for tests (SQLite)
process.env.DATABASE_URL = 'file:./test.db';

// Cleanup after all tests finish
afterAll(async () => {
  await disconnectDb();
});
