// tests/fixtures/f7-worker.mjs
// f7 并发修复回归 worker：走 dist 编译产物（与真实 agent 调用同一代码路径）。
// 用法: node f7-worker.mjs <mode> <rootDir> [args...]
// 模式:
//   adr    <rootDir> <title>                  → createAdr，输出 "OK <id>"
//   node   <rootDir> <id> <label>             → createNode，输出 "OK"
//   write  <rootDir> <id> <prefix> <count>    → 循环 writeNode（快照压力源），输出 "OK <count>"
//   wsevent<rootDir> <detail>                 → appendWorkspaceEvent，输出 "OK"
import { createAdr, createNode } from "../../dist/core/node.js";
import { writeNode } from "../../dist/core/parser.js";
import { appendWorkspaceEvent } from "../../dist/core/graph-dir.js";

const [, , mode, rootDir, ...args] = process.argv;

function baseNode(id, label) {
  return {
    id,
    type: "task",
    label,
    level: 1,
    status: "pending",
    attempts: 0,
    max_attempts: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

try {
  if (mode === "adr") {
    const node = createAdr(rootDir, { title: args[0], decision: "决策内容" });
    console.log(`OK ${node.id}`);
  } else if (mode === "node") {
    createNode(rootDir, { id: args[0], type: "task", label: args[1] });
    console.log("OK");
  } else if (mode === "write") {
    const [, prefix, count] = args;
    const n = parseInt(count, 10);
    const node = baseNode(args[0], `${prefix}-0`);
    for (let i = 0; i < n; i++) {
      node.label = `${prefix}-${i}`;
      node.updated_at = new Date().toISOString();
      writeNode(rootDir, node);
    }
    console.log(`OK ${n}`);
  } else if (mode === "wsevent") {
    appendWorkspaceEvent(rootDir, "switch", args[0]);
    console.log("OK");
  } else {
    console.log(`ERR unknown mode: ${mode}`);
    process.exit(1);
  }
} catch (err) {
  console.log(`ERR ${err.message}`);
  process.exit(0); // 错误也走 stdout 断言，不炸测试运行器
}
