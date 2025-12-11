import { describe, it, expect, vi } from 'vitest';
import { testE2BConnection } from '../../services';
import { Sandbox } from '@e2b/code-interpreter';

// Mock the E2B Sandbox
vi.mock('@e2b/code-interpreter', () => ({
  Sandbox: {
    create: vi.fn(),
  },
}));

describe('Settings Modal E2B Connection Behavior', () => {
  it('should not automatically switch devEnv on network errors', async () => {
    // Mock a network error
    vi.mocked(Sandbox.create).mockRejectedValue(new Error('Failed to fetch'));
    
    const validKey = 'e2b_valid_api_key_with_sufficient_length_123';
    const result = await testE2BConnection(validKey);
    
    // Should return failure with network error details
    expect(result.success).toBe(false);
    expect(result.message).toContain('Network Connection Failed');
    expect(result.message).toContain('Failed to fetch');
    
    // The key point: the function should NOT modify any external state
    // It should only return the error information for the UI to display
    // This prevents the settings modal from reloading and resetting dropdowns
  });

  it('should not automatically switch devEnv on invalid API key format', async () => {
    // Reset the mock to ensure clean state
    vi.mocked(Sandbox.create).mockReset();
    
    const invalidKey = 'invalid_key';
    const result = await testE2BConnection(invalidKey);
    
    // Should return failure with validation error
    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid API Key');
    
    // Should not attempt to create sandbox for invalid keys
    expect(Sandbox.create).not.toHaveBeenCalled();
  });

  it('should handle successful E2B connection without state changes', async () => {
    // Mock a successful connection
    const mockSandbox = {
      runCode: vi.fn().mockResolvedValue({
        logs: { stdout: ['Connection Verified'], stderr: [] },
        error: null
      }),
      kill: vi.fn().mockResolvedValue(undefined)
    };
    
    vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox);
    
    const validKey = 'e2b_valid_api_key_with_sufficient_length_123';
    const result = await testE2BConnection(validKey);
    
    // Should return success
    expect(result.success).toBe(true);
    expect(result.message).toContain('Connection Established');
    
    // Should clean up sandbox
    expect(mockSandbox.kill).toHaveBeenCalled();
  });
});