
import { test, expect } from '@playwright/test';

// Note: This test assumes the app is running locally on port 3000
test.describe('Recursive DevOps Agent E2E', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
  });

  test('should render the dashboard header and support simulation', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Recursive DevOps Agent');
    await expect(page.locator('text=SIMULATE SWARM')).toBeVisible();
    
    // Start Simulation
    await page.click('button:has-text("SIMULATE SWARM")');
    
    // Check if logs appear in the log column
    const logColumn = page.locator('textarea').first();
    await expect(logColumn).toBeVisible();
    
    // Check for Terminal Output updates
    const terminal = page.locator('.font-mono').first();
    await expect(terminal).toBeVisible();
    
    // Verify tabs
    await expect(page.locator('button:has-text("ALL")')).toBeVisible();
  });

  test('should configure uplink via settings', async ({ page }) => {
    // Open Settings (first button in header)
    await page.locator('header button').first().click();
    
    await expect(page.getByText('Pipeline Uplink Config')).toBeVisible();
    
    // Mock GitHub API requests
    await page.route('**/pulls/1', async route => {
        await route.fulfill({ json: { head: { sha: 'sha123' } } });
    });
    
    await page.route('**/actions/runs?head_sha=sha123', async route => {
        await route.fulfill({ json: { 
            workflow_runs: [
                { id: 1, name: 'Failed Workflow', conclusion: 'failure', head_sha: 'sha123', path: '.github/workflows/fail.yml' }
            ] 
        }});
    });

    // Fill form
    await page.getByPlaceholder('ghp_...').fill('mock_token');
    await page.getByPlaceholder('https://github.com/owner/repo/pull/123').fill('https://github.com/owner/repo/pull/1');
    
    // Load runs
    await page.getByText('Load Failed Runs').click();
    
    // Verify run appears
    await expect(page.getByText('Failed Workflow')).toBeVisible();
    
    // Select the run (click Select All)
    await page.getByText('Select All').click();
    
    // Save
    await page.getByText('Initialize Link').click();
    
    // Verify success state
    await expect(page.getByText('LIVE UPLINK ACTIVE')).toBeVisible();
    await expect(page.locator('text=ENGAGE SWARM')).toBeVisible();
  });

});
