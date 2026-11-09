import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: process.env.CI?90000:60000,
  // Software WebGL compiles shaders much more slowly than a local GPU.
  expect: {timeout: process.env.CI?20000:10000},
  // Keep actions/DOM/network traces; continuous screencasts compete with SwiftShader.
  // Explicit pixel screenshots and failure screenshots remain enabled.
  use: { trace:{mode:'retain-on-failure',screenshots:false}, screenshot:'only-on-failure', channel: 'chromium', locale: 'ja-JP', baseURL: 'http://127.0.0.1:31339', viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader'] } },
});
