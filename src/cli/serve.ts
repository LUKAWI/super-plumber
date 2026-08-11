import { Command } from "commander";
import { startServer } from "../web/server.js";

export const serveCommand = new Command("serve").alias("sv")
  .description("启动 Web 可视化服务")
  .option("-p, --port <port>", "端口号", "8934")
  .option("--no-open", "启动后不自动打开浏览器（默认自动打开）")
  .action((options) => {
    startServer(process.cwd(), parseInt(options.port, 10), {
      open: options.open !== false,
    });
  });
