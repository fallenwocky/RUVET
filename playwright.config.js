// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:8765', serviceWorkers: 'block', trace: 'off' },
  webServer: { command: 'node tests/server.js 8765', url: 'http://localhost:8765/index.html', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'phone', use: { ...devices['iPhone 14'], browserName: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
  ],
});
