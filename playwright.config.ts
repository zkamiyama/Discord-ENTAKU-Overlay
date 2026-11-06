import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: { channel: 'chromium', locale: 'ja-JP', baseURL: 'http://127.0.0.1:31339', viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader'] } },
  webServer: { command: 'bun run scripts/e2e-server.ts', url: 'http://127.0.0.1:31339/api/health', reuseExistingServer: false, timeout: 15000 },
});
