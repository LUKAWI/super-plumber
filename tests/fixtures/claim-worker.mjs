// tests/fixtures/claim-worker.mjs
// 并发认领测试 worker：走 dist 编译产物（与真实 agent 调用同一代码路径）。
// 用法: node claim-worker.mjs <rootDir> <nodeId> <claimBy>
// 输出: "OK <assigned_to>" 或 "ERR <message>"
import { updateNodeStatus } from "../../dist/core/node.js";

const [, , rootDir, nodeId, claimBy] = process.argv;

try {
  const node = updateNodeStatus(rootDir, nodeId, "running", claimBy);
  console.log(`OK ${node.assigned_to}`);
} catch (err) {
  console.log(`ERR ${err.message}`);
}
