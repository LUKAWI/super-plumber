// src/cli/serve.ts — arch-c1（C1）全迁：工作区级杂项命令（workspace 模式跳过图
// 目录解析——serve 作用于整个工作区，未初始化也允许启动）。
// S3-17：--port abc 曾把 NaN 直送 listen；进服务器前统一 coerce（1-65535）——
// coerceInt 已是纯函数，非法值抛 CliUsageError 由 runner 渲染退出（不进 startServer）。
import { startServer } from "../web/server.js";
import { coerceInt } from "./coerce.js";
import { defineCommand } from "./runner.js";

export const serveCommand = defineCommand("serve", { workspace: true }).alias("sv")
  .description("启动 Web 可视化服务")
  .option("-p, --port <port>", "端口号", "8934")
  .option("--no-open", "启动后不自动打开浏览器（默认自动打开）")
  .action((options: { port: string; open?: boolean }) => {
    const port = coerceInt("--port", options.port, { def: 8934, min: 1, max: 65535 });
    startServer(process.cwd(), port, {
      open: options.open !== false,
    });
  });
