import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', fullyParallel: false, workers: 1, timeout: 90000,
  use: { baseURL: 'http://127.0.0.1:3100', viewport: { width: 1440, height: 1050 }, browserName: 'chromium', channel: 'chrome', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'npx tsx scripts/browser-test-server.ts', port: 4100, reuseExistingServer: false },
    { command: 'npm run dev -w @classroom/web -- --port 3100', url: 'http://127.0.0.1:3100', env: { NEXT_DIST_DIR: '.next-test', NEXT_PUBLIC_BACKEND_URL: 'http://127.0.0.1:4100' }, reuseExistingServer: false },
  ],
});
