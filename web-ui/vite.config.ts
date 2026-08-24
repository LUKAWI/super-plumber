import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  build: { outDir: "dist" },
  // vitest 默认走 SSR transform（svelte 组件编译成服务端版，mount 不可用）；
  // 组件级测试（render-smoke）需要客户端编译，browser condition 是
  // Svelte 5 官方测试配方。对 build 无影响（客户端应用本就以浏览器为目标）
  resolve: {
    conditions: ["browser"],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
