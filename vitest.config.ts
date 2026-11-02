import { defineConfig } from "vitest/config";

const timeoutOverride = process.env.PI_COFFEE_TEST_TIMEOUT_MS
  ? Math.min(60000, Math.max(1000, Number(process.env.PI_COFFEE_TEST_TIMEOUT_MS) || 5000))
  : undefined;

export default defineConfig({
  test: {
    // Native fixtures each own subprocesses/workers; bound aggregate VM load.
    maxWorkers: process.env.CI ? 1 : 4,
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Shared-host Git subprocess fixtures can exceed the local five-second
    // budget. Keep the default, while allowing a bounded verification override.
    // Async Git operations also need the same bounded polling budget. Without
    // it, expect.poll still stops after one second inside a longer test.
    ...(timeoutOverride ? {testTimeout:timeoutOverride,expect:{poll:{timeout:timeoutOverride}}} : {}),
  },
});
