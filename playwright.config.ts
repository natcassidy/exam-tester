import { defineConfig, devices } from '@playwright/test';

// End-to-end checks of the "getting unstuck" flows in a real browser: npm run e2e
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5199', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: { command: 'npx vite --port 5199 --strictPort', url: 'http://localhost:5199', reuseExistingServer: true, timeout: 60_000 },
});
