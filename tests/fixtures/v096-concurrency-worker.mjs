// v0.9.6 并发一致性回归 worker：走 dist 编译产物，模拟真实跨进程调用。
import * as fs from "node:fs";
import * as path from "node:path";
import { createGraph, toGraphDir } from "../../dist/core/graph-dir.js";
import { createEdge } from "../../dist/core/edge.js";
import { withLockSync } from "../../dist/core/lock.js";

const [, , mode, rootDir, ...args] = process.argv;

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

try {
  if (mode === "graph") {
    createGraph(rootDir, args[0], args[1] ?? args[0]);
    console.log("OK graph");
  } else if (mode === "edge-race") {
    const [source, target, signal, countText] = args;
    fs.writeFileSync(signal, "started", "utf-8");
    const count = Number.parseInt(countText ?? "20", 10);
    let created = 0;
    for (let i = 0; i < count; i++) {
      try {
        createEdge(rootDir, {
          id: `race-edge-${i}`,
          source,
          target,
          type: "depends_on",
        });
        created++;
      } catch {
        // 节点删除先后次序决定本次尝试是成功还是预期的 not found。
      }
    }
    console.log(`OK edges=${created}`);
  } else if (mode === "hold-lock") {
    const [id, signal, durationText] = args;
    const duration = Number.parseInt(durationText ?? "500", 10);
    const lockFile = path.join(toGraphDir(rootDir), ".locks", `${encodeURIComponent(id)}.lock`);
    withLockSync(rootDir, id, () => {
      fs.writeFileSync(signal, lockFile, "utf-8");
      sleepSync(duration);
    });
    console.log("OK lock");
  } else {
    console.log(`ERR unknown mode: ${mode}`);
    process.exit(1);
  }
} catch (err) {
  console.log(`ERR ${err?.message ?? String(err)}`);
  process.exit(0);
}
