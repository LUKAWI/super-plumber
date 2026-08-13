#!/usr/bin/env node
// src/cli/index.ts
import { Command } from "commander";
import { VERSION } from "../version.js";
import { initCommand } from "./init.js";
import { createNodeCommand } from "./create-node.js";
import { addEdgeCommand } from "./add-edge.js";
import { statusCommand } from "./status.js";
import { exportMermaidCommand } from "./export-mermaid.js";
import { serveCommand } from "./serve.js";
import { deleteNodeCommand } from "./delete-node.js";
import { deleteEdgeCommand } from "./delete-edge.js";
import { validateCommand } from "./validate.js";
import { rebuildCommand } from "./rebuild.js";
import { updateStatusCommand } from "./update-status.js";
import { updateNodeCommand } from "./update-node.js";

const program = new Command();

program
  .name("graph")
  .description("工作流拓扑图管理工具")
  .version(VERSION);

program.addCommand(initCommand);
program.addCommand(createNodeCommand);
program.addCommand(addEdgeCommand);
program.addCommand(statusCommand);
program.addCommand(exportMermaidCommand);
program.addCommand(serveCommand);
program.addCommand(deleteNodeCommand);
program.addCommand(deleteEdgeCommand);
program.addCommand(validateCommand);
program.addCommand(rebuildCommand);
program.addCommand(updateStatusCommand);
program.addCommand(updateNodeCommand);

program.parse(process.argv);
