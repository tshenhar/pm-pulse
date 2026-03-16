import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    env: { NODE_ENV: "test" },
    exclude: [
      "**/node_modules/**",
      "**/browser/**", // Playwright .spec.ts files — run via npm run test:browser
    ],
    // SQLite test DB is shared across all files — run files sequentially to prevent state contamination
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
