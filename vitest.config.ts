import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Native fixtures each own subprocesses/workers; bound aggregate VM load.
    maxWorkers: process.env.CI ? 1 : 4,
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Shared-host Git subprocess fixtures can exceed the local five-second
    // budget. Keep the default, while allowing a bounded verification override.
    ...(process.env.PI_COFFEE_TEST_TIMEOUT_MS ? {testTimeout:Math.min(60000,Math.max(1000,Number(process.env.PI_COFFEE_TEST_TIMEOUT_MS)||5000))} : {}),
  },
});
