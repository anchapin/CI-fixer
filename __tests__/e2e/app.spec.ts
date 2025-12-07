
import { test, expect } from '@playwright/test';

// Note: This test assumes the app is running locally on port 3000
test.describe('Recursive DevOps Agent E2E', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
  });

  test('should render the dashboard header', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Recursive DevOps Agent');
    await expect(page.locator('text=SIMULATE SWARM')).toBeVisible();
  });

  test('should run simulation mode successfully', async ({ page }) => {
    // Start Simulation
    await page.click('button:has-text("SIMULATE SWARM")');
    
    // Check if logs appear in the log column
    const logColumn = page.locator('textarea').first();
    await expect(logColumn).toBeVisible();
    
    // Check for Terminal Output updates
    const terminal = page.locator('.font-mono');
    await expect(terminal).toContainText('Initializing Simulation');
    
    // Wait for agent status to appear
    await expect(page.locator('text=Simulation Agent')).toBeVisible();
    
    // Verify tabs
    await expect(page.locator('button:has-text("ALL")')).toBeVisible();
  });

  test('should open settings modal', async ({ page }) => {
    // Click Settings Icon (assuming it's the first button in header group or identified by icon class)
    // Using a more robust selector if possible, or index
    const settingsButton = page.locator('header button').first(); 
    await settingsButton.click();
    
    await expect(page.locator('text=Pipeline Uplink Config')).toBeVisible();
    await expect(page.locator('input[placeholder*="ghp_"]')).toBeVisible();
  });

});
