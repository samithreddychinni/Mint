import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 240000,
  workers: 1,
  expect: { timeout: 60000 },
  use: {
    baseURL: process.env.MINT_DEPLOYMENT_URL || "http://localhost:3000",
    viewport: { width: 390, height: 844 },
    trace: "off",
    screenshot: "off",
  },
  reporter: [["list"]],
  outputDir: ".local/browser-results",
});
