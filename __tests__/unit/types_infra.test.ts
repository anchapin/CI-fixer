import { AgentPhase, ErrorCategory } from '../../types';

describe('Infrastructure Types', () => {
  it('should have ENVIRONMENT_SETUP and PROVISIONING phases', () => {
    expect(AgentPhase.ENVIRONMENT_SETUP).toBe('ENVIRONMENT_SETUP');
    expect(AgentPhase.PROVISIONING).toBe('PROVISIONING');
  });

  it('should have INFRASTRUCTURE error category', () => {
    expect(ErrorCategory.INFRASTRUCTURE).toBe('infrastructure');
  });
});
