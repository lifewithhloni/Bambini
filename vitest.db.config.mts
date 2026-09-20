import { defineConfig } from "vitest/config";

// Separate from vitest.config.mts on purpose: these tests boot a real
// Postgres engine (PGlite) and apply every migration per file, which
// takes on the order of 15-20s — far slower than the unit tests in
// src/**/*.test.ts. Keeping them in their own config/command means
// `npm run test` (the fast, run-on-every-save loop) stays fast, and DB
// validation is a deliberate `npm run test:db` step. See DATABASE.md.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
