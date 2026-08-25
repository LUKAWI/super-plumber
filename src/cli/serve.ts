import { Command } from "commander";
import { startServer } from "../web/server.js";
import { coerceInt } from "./coerce.js";

export const serveCommand = new Command("serve").alias("sv")
  .description("启动 Web 可视化服务")
  .option("-p, --port <port>", "端口号", "8934")
  .option("--no-open", "启动后不自动打开浏览器（默认自动打开）")
  .action((options) => {
    // S3-17：--port abc 曾把 NaN 直送 listen；进服务器前统一 coerce（1-65535）
    const port = coerceInt("--port", options.port, { def: 8934, min: 1, max: 65535 });
    startServer(process.cwd(), port, {
      open: options.open !== false,
    });
  });
