import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateE2BApiKey, testE2BConnection } from '../../services';
import { Sandbox } from '@e2b/code-interpreter';

// Mock the E2B Sandbox
vi.mock('@e2b/code-interpreter', () => ({
  Sandbox: {
    create: vi.fn(),
  },
}));

describe('E2B API Key Validation', () => {
  it('should validate correct E2B API key format', () => {
    const validKey = 'e2b_valid_api_key_with_sufficient_length_123';
    const result = validateE2BApiKey(validKey);
    expect(result.valid).toBe(true);
    expect(result.message).toContain('valid');
  });

  it('should reject empty API keys', () => {
    const result = validateE2BApiKey('');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('empty');
  });

  it('should reject API keys without e2b_ prefix', () => {
    const invalidKey = 'invalid_key_without_prefix';
    const result = validateE2BApiKey(invalidKey);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('e2b_');
  });

  it('should reject API keys that are too short', () => {
    const shortKey = 'e2b_short';
    const result = validateE2BApiKey(shortKey);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('too short');
  });

  it('should reject API keys with invalid characters', () => {
    const invalidKey = 'e2b_key with spaces and extra length';
    const result = validateE2BApiKey(invalidKey);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('invalid characters');
  });
});

describe('E2B Connection Testing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should reject invalid API key format before attempting connection', async () => {
    const invalidKey = 'invalid_key';
    const result = await testE2BConnection(invalidKey);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid API Key');
    expect(Sandbox.create).not.toHaveBeenCalled();
  });

  it('should handle network errors with detailed debugging info', async () => {
    // Mock a network error
    vi.mocked(Sandbox.create).mockRejectedValue(new Error('Failed to fetch'));

    const validKey = 'e2b_valid_api_key_with_sufficient_length_123';
    const promise = testE2BConnection(validKey);

    // Advance timers to trigger retries
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(10000);
    }

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.message).toContain('Network Connection Failed');
    expect(result.message).toContain('check connectivity');
  });

  it('should handle authentication errors specifically', async () => {
    // Mock an authentication error
    vi.mocked(Sandbox.create).mockRejectedValue(new Error('401 Unauthorized'));

    const validKey = 'e2b_valid_api_key_with_sufficient_length_123';
    const promise = testE2BConnection(validKey);

    // Advance timers to trigger retries
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(10000);
    }

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.message).toContain('Authentication Failed');
    expect(result.message).toContain('verify your E2B API key');
  });

  it('should handle timeout errors specifically', async () => {
    // Mock a timeout error
    vi.mocked(Sandbox.create).mockRejectedValue(new Error('Connection timeout'));

    const validKey = 'e2b_valid_api_key_with_sufficient_length_123';
    const promise = testE2BConnection(validKey);

    // Advance timers to trigger retries
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(10000);
    }

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.message).toContain('Connection Timeout');
    expect(result.message).toContain('temporarily unavailable');
  });
});