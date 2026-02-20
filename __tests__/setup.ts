import { vi } from 'vitest';

// Mock e2b and @e2b/code-interpreter globally to avoid ERR_REQUIRE_ESM
// caused by their CJS builds trying to require ESM chalk v5.
vi.mock('e2b', () => {
  return {
    Sandbox: class MockSandbox {
      id = 'mock-sandbox-id';
      close = vi.fn();
      keepAlive = vi.fn();
      filesystem = {
        read: vi.fn(),
        write: vi.fn(),
        makeDir: vi.fn(),
        list: vi.fn(),
      };
      process = {
        start: vi.fn(),
        startAndWait: vi.fn(),
      };
    },
  };
});

vi.mock('@e2b/code-interpreter', () => {
  return {
    CodeInterpreter: class MockCodeInterpreter {
      id = 'mock-interpreter-id';
      close = vi.fn();
      keepAlive = vi.fn();
      notebook = {
        execCell: vi.fn(),
      };
      filesystem = {
        read: vi.fn(),
        write: vi.fn(),
        makeDir: vi.fn(),
        list: vi.fn(),
      };
      process = {
        start: vi.fn(),
        startAndWait: vi.fn(),
      };
    },
  };
});
