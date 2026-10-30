import { defineConfig } from "vitest/config";

// Tests must never read a developer's real .env (dotenv does not override
// variables that are already set), or they would call live LTA with a real key.
export default defineConfig({
  test: {
    env: { LTA_ACCOUNT_KEY: "", ENABLE_MOCK_DISRUPTIONS: "false" },
  },
});
