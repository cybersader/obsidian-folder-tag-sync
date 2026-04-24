import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: process.env.TEST_URL || 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // When TEST_URL is set we're hitting a live deployment; don't boot a server.
  // Otherwise, boot the Astro preview server (matches production routing).
  webServer: process.env.TEST_URL ? undefined : {
    command: 'bun run preview',
    url: 'http://localhost:4321/obsidian-folder-tag-sync/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
