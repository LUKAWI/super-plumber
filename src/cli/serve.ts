import { Command } from "commander";
import { startServer } from "../web/server.js";

export const serveCommand = new Command("serve")
  .description("启动 Web 可视化服务")
  .option("-p, --port <port>", "端口号", "8934")
  .action((options) => {
    startServer(process.cwd(), parseInt(options.port, 10));
  });
