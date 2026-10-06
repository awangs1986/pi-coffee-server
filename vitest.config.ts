import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Native fixtures each own subprocesses/workers; bound aggregate VM load.
    maxWorkers: process.env.CI ? 2 : 4,
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
