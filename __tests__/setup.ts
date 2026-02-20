import { vi } from 'vitest';

// Set DATABASE_URL if not already set, to prevent Prisma validation errors during tests
if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'file:./test.db';
}

// Mock other environment variables if needed
if (!process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = 'mock_key';
}
