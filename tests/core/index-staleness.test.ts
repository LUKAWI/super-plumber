// tests/core/index-staleness.test.ts — fix_index_cache 回归
// 根因：Windows NTFS mtime 滞后墙钟 ~2ms，"mtime > builtAt" 判新鲜会把
// 写后状态误判为缓存新鲜 → 同进程写后读永久陈旧。修复：写路径主动 invalidateIndex。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createNode, updateNodeStatus } from "../../src/core/node.js";
import { writeNode, readNode } from "../../src/core/parser.js";
import {
  buildGraphIndex,
  computeNextActions,
  resetIndexCache,
} from "../../src/core/index-service.js";
import { NodeStatus, NodeType } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-stale-"));
  resetIndexCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetIndexCache();
});

describe("fix_index_cache：写后读一致性", () => {
  it("updateNodeStatus 后同进程 next-actions 立即看到新状态（不依赖时钟）", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    // 预热爱缓存（此时 t1 = pending）
    expect(buildGraphIndex(tmpDir, { useCache: true }).nodes[0].status).toBe(
      NodeStatus.Pending,
    );

    updateNodeStatus(tmpDir, "t1", NodeStatus.Ready); // 内部 checkReadyGate 重建缓存后 writeNode

    // 修复前：Windows mtime 滞后会让缓存被判新鲜，这里仍返回 pending → ready 桶为空
    const next = computeNextActions(tmpDir);
    expect(next.ready.map((r) => r.id)).toContain("t1");
  });

  it("writeNode 直接落盘后同进程索引立即反映新内容", () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "旧标签" });
    buildGraphIndex(tmpDir, { useCache: true }); // 热缓存

    const node = readNode(tmpDir, "t1");
    node.label = "新标签";
    writeNode(tmpDir, node);

    expect(buildGraphIndex(tmpDir, { useCache: true }).nodes[0].label).toBe("新标签");
  });

  it("invalidateIndex 清除磁盘缓存（下次构建回源并重写）", async () => {
    createNode(tmpDir, { id: "t1", type: NodeType.Task, label: "T1" });
    buildGraphIndex(tmpDir, { useCache: true });
    const cacheFile = path.join(tmpDir, ".graph/index/graph.json");
    expect(fs.existsSync(cacheFile)).toBe(true);

    const node = readNode(tmpDir, "t1");
    node.label = "改";
    writeNode(tmpDir, node); // 内部 invalidateIndex

    // 磁盘缓存已被失效删除（或重建后内容为新标签）
    if (fs.existsSync(cacheFile)) {
      expect(JSON.parse(fs.readFileSync(cacheFile, "utf-8")).nodes[0].label).toBe("改");
    }
    expect(buildGraphIndex(tmpDir, { useCache: true }).nodes[0].label).toBe("改");
  });
});
