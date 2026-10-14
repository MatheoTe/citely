import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;
// The E2E run always uses offline providers and its own throwaway database.
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "pglite://./.data/e2e";
const resetDb = DATABASE_URL.startsWith("pglite://") ? "rm -rf .data/e2e && " : "";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // Locally, PW_CHANNEL=chrome reuses an installed Google Chrome instead of downloading Chromium.
      use: { ...devices["Desktop Chrome"], ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) },
    },
  ],
  webServer: {
    command: `${resetDb}npx tsx scripts/migrate.ts && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL,
      CITELY_LLM_PROVIDER: "offline",
      CITELY_EMBEDDINGS_PROVIDER: "local",
      CITELY_RERANKER: "none",
      CITELY_RATE_LIMIT_PER_MINUTE: "1000",
      // `next start` also reads .env; explicit empty keys keep E2E offline regardless.
      ANTHROPIC_API_KEY: "",
      VOYAGE_API_KEY: "",
    },
  },
});
