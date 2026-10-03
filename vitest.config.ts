import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Native fixtures each own subprocesses/workers; bound aggregate VM load.
    maxWorkers: 4,
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
