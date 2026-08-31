#!/usr/bin/env node
// src/cli/index.ts
import { Command } from "commander";
import { VERSION } from "../version.js";
import { initCommand } from "./init.js";
import { createNodeCommand } from "./create-node.js";
import { getNodeCommand } from "./get-node.js";
import { addEdgeCommand } from "./add-edge.js";
import { statusCommand } from "./status.js";
import { exportMermaidCommand } from "./export-mermaid.js";
import { serveCommand } from "./serve.js";
import { deleteNodeCommand } from "./delete-node.js";
import { deleteEdgeCommand } from "./delete-edge.js";
import { validateCommand } from "./validate.js";
import { rebuildCommand } from "./rebuild.js";
import { updateStatusCommand } from "./update-status.js";
import { reclaimCommand } from "./reclaim.js";
import { updateNodeCommand } from "./update-node.js";
import { updateGraphCommand } from "./update-graph.js";
import { approveCommand } from "./approve.js";
import { nextCommand } from "./next.js";
import { verdictCommand } from "./verdict.js";
import { snapshotCommand, snapshotsCommand } from "./snapshot.js";
import { diffCommand } from "./diff.js";
import { rollbackCommand } from "./rollback.js";
import { eventsCommand } from "./events.js";
import { adrCommand } from "./adr.js";
import { switchCommand, listGraphsCommand, renameGraphCommand, deleteGraphCommand } from "./graph-ops.js";
import { setGraphOverride } from "./graph-ctx.js";

const program = new Command();

program
  .name("graph")
  .description("工作流拓扑图管理工具")
  .version(VERSION);

program.addCommand(initCommand);
program.addCommand(createNodeCommand);
program.addCommand(getNodeCommand);
program.addCommand(addEdgeCommand);
program.addCommand(statusCommand);
program.addCommand(exportMermaidCommand);
program.addCommand(serveCommand);
program.addCommand(deleteNodeCommand);
program.addCommand(deleteEdgeCommand);
program.addCommand(validateCommand);
program.addCommand(rebuildCommand);
program.addCommand(updateStatusCommand);
program.addCommand(reclaimCommand);
program.addCommand(updateNodeCommand);
program.addCommand(updateGraphCommand);
program.addCommand(approveCommand);
program.addCommand(nextCommand);
program.addCommand(verdictCommand);
program.addCommand(snapshotCommand);
program.addCommand(snapshotsCommand);
program.addCommand(diffCommand);
program.addCommand(rollbackCommand);
program.addCommand(eventsCommand);
program.addCommand(adrCommand);
program.addCommand(switchCommand);
program.addCommand(listGraphsCommand);
program.addCommand(renameGraphCommand);
program.addCommand(deleteGraphCommand);

// v0.5.2：--graph 参数对全部数据命令可用（init/switch/list/rename-graph/delete-graph
// 自带图名参数除外）。preAction 钩子统一收集，graph-ctx 的五级链解析消费。
const GRAPH_SELF_NAMED = new Set(["init", "i", "switch", "sw", "list", "ls", "rename-graph", "rg", "delete-graph", "dg", "serve"]);
for (const cmd of program.commands) {
  if (!GRAPH_SELF_NAMED.has(cmd.name()) && !cmd.options.some((o) => o.long === "--graph")) {
    cmd.option("--graph <名>", "目标图（缺省按 SUPER_PLUMBER_GRAPH > .graph/active > default 解析）");
  }
}
program.hook("preAction", (_thisCmd, actionCmd) => {
  setGraphOverride(actionCmd.opts()?.graph);
});

program.parse(process.argv);
