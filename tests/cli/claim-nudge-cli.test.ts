// tests/cli/claim-nudge-cli.test.ts — arch-c3a：CLI update-status 认领输出消费
// core 单源提示包（buildClaimNudgePackage）：review_flag 补齐（此前 CLI 缺）+
// superseded ⚠️ 措辞与调度面 adr_flags 文案同源（手写变体消灭）。
// 断言针对 dist 构建（vitest 前置 npm run build），与既有 CLI 测试同构。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { REVIEW_FLAG_UNREVIEWED } from "../../src/core/scheduler.js";

const CLI = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-claim-nudge-cli-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: tmpDir,
    encoding: "utf-8",
  });
}

function runOk(args: string[]): string {
  const r = run(args);
  expect(r.status, `命令失败: ${args.join(" ")}\n${r.stderr}`).toBe(0);
  return r.stdout;
}

function setupClaimable(id: string): void {
  runOk(["init", "t"]);
  runOk(["create-node", "--id", id, "--label", `任务${id}`]);
  runOk(["update-status", "-i", id, "-s", "ready"]);
}

describe("update-status 认领输出（claim 提示包单源）", () => {
  it("图无 review 凭据：认领输出补齐 review_flag 定稿文案（仅提示，认领成功）", () => {
    setupClaimable("a");
    const out = runOk(["update-status", "-i", "a", "-s", "running", "--claim-by", "agent-1"]);
    expect(out).toContain(REVIEW_FLAG_UNREVIEWED);
  });

  it("写入审核凭据后：认领输出不再出现 review_flag（零门禁照常认领）", () => {
    setupClaimable("b");
    runOk(["approve", "--by", "alice"]);
    const out = runOk(["update-status", "-i", "b", "-s", "running", "--claim-by", "agent-2"]);
    expect(out).not.toContain(REVIEW_FLAG_UNREVIEWED);
    expect(out).toContain("running");
  });

  it("superseded 管辖 ADR：⚠️ 行与调度面 adr_flags 文案逐字同源；📖 管辖 ADR 与 review_flag 同响应出现", () => {
    runOk(["init", "t"]);
    runOk(["adr", "create", "--title", "旧决策", "--decision", "d1"]);
    runOk(["adr", "create", "--title", "新决策", "--decision", "d2"]);
    runOk(["adr", "accept", "--id", "adr_0001"]);
    runOk(["adr", "accept", "--id", "adr_0002"]);
    runOk(["adr", "supersede", "--id", "adr_0001", "--by", "adr_0002"]);
    runOk(["create-node", "--id", "t1", "--label", "T1"]);
    runOk(["add-edge", "--id", "d1", "--source", "adr_0001", "--target", "t1", "--type", "decides"]);
    runOk(["add-edge", "--id", "d2", "--source", "adr_0002", "--target", "t1", "--type", "decides"]);
    runOk(["update-status", "-i", "t1", "-s", "ready"]);

    const out = runOk(["update-status", "-i", "t1", "-s", "running", "--claim-by", "agent-3"]);
    // adr_flags 同源文案（与 next 桶 adrFlagsFor 派生串逐字一致）
    expect(out).toContain(
      "ADR adr_0001（旧决策）已 superseded（由 adr_0002 接替）——决策依据已过时，建议重审",
    );
    // 旧 CLI 手写变体（"决策依据已过时: " 冒号形态）不再出现
    expect(out).not.toContain("决策依据已过时:");
    // governing_adrs（📖 必读指针）与 review_flag 同响应出现
    expect(out).toContain("📖 管辖 ADR（必读）: adr_0002 新决策");
    expect(out).toContain(REVIEW_FLAG_UNREVIEWED);
  });
});

describe("get-node 输出（arch-c3a 残留收敛）", () => {
  it("superseded ⚠️ 行与调度面 adr_flags 文案逐字同源，旧冒号变体绝迹", () => {
    runOk(["init", "t"]);
    runOk(["adr", "create", "--title", "旧决策", "--decision", "d1"]);
    runOk(["adr", "create", "--title", "新决策", "--decision", "d2"]);
    runOk(["adr", "accept", "--id", "adr_0001"]);
    runOk(["adr", "accept", "--id", "adr_0002"]);
    runOk(["adr", "supersede", "--id", "adr_0001", "--by", "adr_0002"]);
    runOk(["create-node", "--id", "t1", "--label", "T1"]);
    runOk(["add-edge", "--id", "d1", "--source", "adr_0001", "--target", "t1", "--type", "decides"]);
    runOk(["add-edge", "--id", "d2", "--source", "adr_0002", "--target", "t1", "--type", "decides"]);

    const out = runOk(["get-node", "-i", "t1"]);
    expect(out).toContain(
      "ADR adr_0001（旧决策）已 superseded（由 adr_0002 接替）——决策依据已过时，建议重审",
    );
    expect(out).not.toContain("决策依据已过时:");
    expect(out).toContain("📖 管辖 ADR（claim 后必读）: adr_0002 新决策");
  });
});
