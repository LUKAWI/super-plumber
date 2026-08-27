// 共享核心加载器（skill 脚本专用）：
// 1) 优先项目本地安装（或包内自引用）；2) 回退全局安装的公开桶 @lukawi/super-plumber/core。
// 不依赖 GNU grep / bash，跨平台（Windows/macOS/Linux）。
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

export async function loadCore() {
  try {
    return await import("@lukawi/super-plumber/core");
  } catch {
    try {
      const globalRoot = execSync("npm root -g").toString().trim();
      const href = pathToFileURL(
        path.join(globalRoot, "@lukawi/super-plumber/dist/core/index.js"),
      ).href;
      return await import(href);
    } catch {
      console.error(
        "❌ 无法定位 super-plumber 核心。请安装: npm install -g @lukawi/super-plumber",
      );
      process.exit(1);
    }
  }
}
