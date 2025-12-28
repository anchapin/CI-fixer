import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as agentTools from '../../../services/sandbox/agent_tools';
import * as fs from 'fs';
import path from 'path';

// We need to mock some things if we want to test agentTools in isolation, 
// OR we can use the fixtures we created.
describe('Agent Tools Grounding Integration', () => {
  const rootDir = path.resolve('__tests__/fixtures/grounding/project');
  
  // We need to make sure agentTools uses our fixture root.
  // In the real app, it uses process.cwd().
  
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue(rootDir);
  });

  it('readFile should auto-correct paths', async () => {
    // backend/v1/api.py -> backend/api.py
    const content = await agentTools.readFile('backend/v1/api.py');
    // Set-Content adds CRLF by default on Windows, or just check trimmed
    expect(content.trim()).toBe('api');
  });

  it('writeFile should auto-correct paths', async () => {
    // backend/api.py is unique
    const res = await agentTools.writeFile('old_backend/api.py', 'new api content');
    // Allow both slash types and normalize
    expect(res.replace(/\\/g, '/')).toContain('Successfully wrote to backend/api.py');
    
    // Verify file content
    const verifiedContent = fs.readFileSync(path.join(rootDir, 'backend/api.py'), 'utf-8');
    expect(verifiedContent.trim()).toBe('new api content');
    
    // Reset fixture content
    fs.writeFileSync(path.join(rootDir, 'backend/api.py'), 'api');
  });

  it('runCmd should auto-correct paths in commands', async () => {
    // Use 'type' for Windows, 'cat' for others if possible, but we are on win32
    const cmd = process.platform === 'win32' ? 'type backend/v1/api.py' : 'cat backend/v1/api.py';
    const output = await agentTools.runCmd(cmd);
    expect(output.trim()).toBe('api');
  });
});
