// tests/core/concurrency-hardening.test.ts
// f7 回归（S1-3/S1-4/S1-7/S1-11/S3-6）：并发缺陷修复的跨进程压力验证。
// 子进程走 tests/fixtures/f7-worker.mjs（dist 编译产物），CI 先 npm run build。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import * as yaml from "js-yaml";
import {
  createGraph,
  writeWorkspaceDefault,
} from "../../src/core/graph-dir.js";
import { readGraph } from "../../src/core/parser.js";
import { validateNode } from "../../src/core/schema.js";
import { createSnapshot } from "../../src/core/snapshot.js";
import { buildGraphIndex, invalidateIndex } from "../../src/core/index-service.js";
import { createNode } from "../../src/core/node.js";
import { writeNode as writeNodeDirect } from "../../src/core/parser.js";
import { NodeType, type NodeSchema } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-f7-"));
  createGraph(tmpDir, "t", "T");
  writeWorkspaceDefault(tmpDir, "t");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runWorker(...args: string[]): Promise<{ out: string; code: number }> {
  const worker = path.resolve("tests/fixtures/f7-worker.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ out: out.trim(), code: code ?? -1 }));
  });
}

describe("S1-3 并发 createAdr（编号唯一，无覆盖）", () => {
  it("4 个进程并发 createAdr → 各得唯一编号，无覆盖无报错", async () => {
    const N = 4;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => runWorker("adr", tmpDir, `决策-${i}`)),
    );
    const ids = results.map((r) => {
      expect(r.out).toMatch(/^OK adr_\d{4}$/);
      return r.out.split(" ")[1];
    });
    expect(new Set(ids).size).toBe(N);
    // 每个文件都是独立合法 ADR（label 各异 = 未被静默覆盖；缺文件 = 覆盖发生）
    const labels = ids.map((id) => {
      const f = path.join(tmpDir, ".graph", "t", "nodes", `${id}.yaml`);
      expect(fs.existsSync(f)).toBe(true);
      const data = yaml.load(fs.readFileSync(f, "utf-8")) as { label: string };
      return data.label;
    });
    expect(new Set(labels).size).toBe(N);
  }, 30_000);
});

describe("S1-4 并发 create-node（不同 id）引用列表不丢条目", () => {
  it("6 个进程并发创建 n1..n6 → graph.yaml 引用列表包含全部 6 项", async () => {
    const N = 6;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        runWorker("node", tmpDir, `n${i + 1}`, `N${i + 1}`),
      ),
    );
    for (const r of results) expect(r.out).toBe("OK");
    const graph = readGraph(tmpDir);
    const refIds = graph.nodes.map((r) =>
      r.file.replace(/^nodes\//, "").replace(/\.yaml$/, ""),
    );
    for (let i = 1; i <= N; i++) {
      expect(refIds).toContain(`n${i}`);
    }
  }, 30_000);
});

describe("S1-11 快照与写路径互斥（无撕裂/混装副本）", () => {
  it("子进程持续 writeNode 期间并发快照：副本完整、引用⊆文件、全部过 schema", async () => {
    // 先放一个基线节点，保证快照非空
    createNode(tmpDir, { id: "base", type: NodeType.Task, label: "基线" });

    const writer = runWorker("write", tmpDir, "hot", "hot-label", "80");
    const snapshots: string[] = [];
    // 写进程存活期间持续快照（真实重叠，非事前事后）
    let writerOut = "";
    for (;;) {
      const m = createSnapshot(tmpDir, "concurrent");
      snapshots.push(m.id);
      const polled = await Promise.race([
        writer.then((w) => ({ done: true as const, w })),
        new Promise((r) => setTimeout(() => r({ done: false as const }), 0)),
      ]);
      if (polled.done) {
        writerOut = polled.w.out;
        break;
      }
    }
    expect(writerOut).toBe("OK 80"); // 写方全程无锁超时（快照不让写方饿死）
    expect(snapshots.length).toBeGreaterThanOrEqual(2);

    // 逐快照断言一致性
    for (const snapId of snapshots) {
      const snapDir = path.join(tmpDir, ".graph", "t", "snapshots", snapId);
      const graphSnap = yaml.load(
        fs.readFileSync(path.join(snapDir, "graph.yaml"), "utf-8"),
      ) as { nodes: { file: string }[] };
      // 引用 ⊆ 文件（无"引用存在但文件缺失"的致命混装）
      for (const ref of graphSnap.nodes) {
        expect(fs.existsSync(path.join(snapDir, ref.file))).toBe(true);
      }
      // manifest 声明的文件全部在副本内
      // （S3-10/f16：manifest 文件名由 manifest.yaml 改为 manifest.json，断言同步）
      const manifest = JSON.parse(
        fs.readFileSync(path.join(snapDir, "manifest.json"), "utf-8"),
      ) as { files: { file: string }[] };
      for (const entry of manifest.files) {
        expect(fs.existsSync(path.join(snapDir, entry.file))).toBe(true);
      }
      // 每个节点副本是完整合法 YAML（无撕裂半写）
      const nodesDir = path.join(snapDir, "nodes");
      for (const f of fs.readdirSync(nodesDir)) {
        if (!f.endsWith(".yaml")) continue;
        const data = yaml.load(fs.readFileSync(path.join(nodesDir, f), "utf-8"));
        expect(validateNode(data)).toEqual([]);
      }
    }
  }, 60_000);
});

describe("S1-7 索引缓存键统一（两种 rootDir 传法写后读一致）", () => {
  it("图目录建缓存 → 工作区根失效 → 图目录再读不陈旧", () => {
    const graphDir = path.join(tmpDir, ".graph", "t");
    createNode(graphDir, { id: "a", type: NodeType.Task, label: "A" });
    const idx1 = buildGraphIndex(graphDir, { useCache: true }); // 键 = resolve(.graph/t)
    expect(idx1.nodes.map((n) => n.id)).toContain("a");

    // 写入 b 后回拨 mtime：模拟 NTFS mtime 滞后（isFresh 判新鲜），
    // 陈旧缓存是否被看见完全取决于失效键是否命中——确定性暴露 S1-7
    const b: NodeSchema = {
      id: "b",
      type: NodeType.Task,
      label: "B",
      level: 1,
      status: "pending",
      attempts: 0,
      max_attempts: 3,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    writeNodeDirect(graphDir, b);
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(graphDir, "nodes", "b.yaml"), past, past);

    invalidateIndex(tmpDir); // 工作区根传法（修复前删错键 resolve(tmpDir)）
    const idx2 = buildGraphIndex(graphDir, { useCache: true });
    expect(idx2.nodes.map((n) => n.id)).toContain("b");
  });
});

describe("S3-6 工作区事件并发追加（无丢行/撕裂）", () => {
  it("6 个进程并发 appendWorkspaceEvent → 6 行完整 JSON", async () => {
    const N = 6;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => runWorker("wsevent", tmpDir, `child-${i}`)),
    );
    for (const r of results) expect(r.out).toBe("OK");
    const f = path.join(tmpDir, ".graph", "workspace-events.jsonl");
    const lines = fs.readFileSync(f, "utf-8").split("\n").filter((l) => l.trim());
    // 全部行完整可解析（任一撕裂行会在此炸出）；子进程的 6 条 switch 无丢失
    const parsed = lines.map((l) => JSON.parse(l));
    expect(
      parsed.filter((e) => e.kind === "switch" && String(e.detail).startsWith("child-")),
    ).toHaveLength(N);
  }, 30_000);
});
