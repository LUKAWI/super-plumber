import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  build: { outDir: "dist" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
