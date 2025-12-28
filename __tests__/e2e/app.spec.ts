
import { test, expect } from '@playwright/test';

// Note: This test assumes the app is running locally on port 3000
test.describe('Recursive DevOps Agent E2E', () => {

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
    page.on('requestfailed', request => console.log(`BROWSER [REQ_FAIL]: ${request.url()} - ${request.failure()?.errorText}`));
  });

  test('should render the dashboard header and support simulation', async ({ page }) => {
    console.log('Navigating to http://localhost:3000...');
    try {
      await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 60000 });
    } catch (e) {
      console.log('Goto failed, checking content anyway...');
    }
    
    console.log('Waiting for header...');
    // Log a bit of the body to see what we actually have
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 100));
    console.log(`Page body starts with: ${bodyText}`);

    const header = page.locator('h1');
    try {
      await expect(header).toBeVisible({ timeout: 30000 });
      await expect(header).toContainText('Recursive DevOps Agent');
    } catch (e) {
      const html = await page.content();
      console.log('DEBUG: HTML Content on failure:', html.substring(0, 1000));
      throw e;
    }
    
    console.log('Header found. Checking for Simulate button...');
    const simulateBtn = page.getByRole('button', { name: /SIMULATE SWARM/i });
    await expect(simulateBtn).toBeVisible({ timeout: 10000 });

    // Start Simulation
    console.log('Clicking SIMULATE SWARM...');
    await simulateBtn.click();

    // Check if logs appear in the terminal column (TerminalOutput component)
    console.log('Waiting for terminal logs...');
    const terminal = page.locator('.terminal-output').first();
    await expect(terminal).toBeVisible({ timeout: 10000 });
    
    // The simulation should start adding logs to the terminal.
    await expect(page.getByText('Analyzing traceback...')).toBeVisible({ timeout: 15000 });

    // Verify tabs
    await expect(page.getByRole('button', { name: 'ALL' })).toBeVisible();
  });

  test('should configure uplink via settings', async ({ page }) => {
    console.log('Navigating to http://localhost:3000 for settings test...');
    await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 60000 });

    // 1. Setup mocks BEFORE any interaction
    console.log('Setting up GitHub API mocks...');
    
    await page.route('**/pulls/1', async route => {
      console.log('Mocking PR fetch:', route.request().url());
      await route.fulfill({ json: { head: { sha: 'sha123' } } });
    });

    await page.route('**/actions/runs?head_sha=sha123', async route => {
      console.log('Mocking runs fetch:', route.request().url());
      await route.fulfill({
        json: {
          workflow_runs: [
            { 
              id: 1, 
              name: 'Failed Workflow', 
              conclusion: 'failure', 
              head_sha: 'sha123', 
              path: '.github/workflows/fail.yml',
              head_branch: 'fix/issue-1'
            }
          ]
        }
      });
    });

    // 2. Open Settings
    console.log('Opening settings modal...');
    const settingsBtn = page.getByRole('button', { name: /Settings/i }).or(page.locator('button[aria-label="Settings"]'));
    try {
      await expect(settingsBtn).toBeVisible({ timeout: 30000 });
      await settingsBtn.click();
    } catch (e) {
      console.log('Failed to find Settings button. Page body:', await page.evaluate(() => document.body.innerText.substring(0, 500)));
      throw e;
    }

    // Verify modal appeared
    await expect(page.getByText('Pipeline Uplink Config')).toBeVisible({ timeout: 10000 });

    // 3. Fill form
    console.log('Filling settings form...');
    await page.getByPlaceholder('ghp_...').fill('mock_token_1234567890');
    await page.getByPlaceholder('https://github.com/owner/repo/pull/123').fill('https://github.com/owner/repo/pull/1');

    // 4. Load runs
    console.log('Clicking Load Failed Runs...');
    const loadBtn = page.getByRole('button', { name: 'Load Failed Runs' });
    await expect(loadBtn).toBeEnabled();
    await loadBtn.click();

    // 5. Verify run loaded 
    console.log('Waiting for Failed Workflows list...');
    // The text contains dynamic numbers, so we use a regex and wait for it to be visible
    const runsHeader = page.getByText(/Failed Workflows \(\d+\/\d+\)/i);
    await expect(runsHeader).toBeVisible({ timeout: 15000 });
    
    const runItem = page.getByText('ID: 1').first();
    await expect(runItem).toBeVisible();
    console.log('Failed Workflows loaded successfully.');

    // 6. Initialize Link
    const initBtn = page.getByRole('button', { name: 'Initialize Link' });
    await expect(initBtn).toBeEnabled({ timeout: 5000 });
    await initBtn.click();

    // 7. Verify success state in Main UI Header
    await expect(page.getByText('LIVE UPLINK ACTIVE')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'ENGAGE SWARM' })).toBeVisible();
  });

});

