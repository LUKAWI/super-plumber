// tests/cli/domain-cli.test.ts — v0.5 规格 C E2E：graph adr 命令组、领域参数、graph export
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync, spawnSync } from "node:child_process";

const CLI_PATH = path.resolve("dist/cli/index.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-cli-v5-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// 参数数组直传（spawnSync），避免 Windows cmd 对 JSON 引号的剥除
function runArr(args: string[]): string {
  const res = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: tmpDir,
    encoding: "utf-8",
  });
  if (res.status !== 0) {
    throw new Error(`CLI 失败: ${args.join(" ")}\n${res.stderr}`);
  }
  return res.stdout;
}

function runFailArr(args: string[]): string {
  const res = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: tmpDir,
    encoding: "utf-8",
  });
  return `${res.stdout ?? ""}${res.stderr ?? ""}`;
}

function run(args: string): string {
  return execSync(`node "${CLI_PATH}" ${args}`, { cwd: tmpDir, encoding: "utf-8" });
}

function readNode(id: string): any {
  return fs.readFileSync(path.join(tmpDir, `.graph/nodes/${id}.yaml`), "utf-8");
}

describe("v0.5 graph adr 命令组", () => {
  it("adr create 自动编号 adr_0001 并落 proposed + adr_created 事件", () => {
    run("init");
    const out = run(
      'adr create --title "纯文件存储" --decision "YAML 存 .graph/，不用数据库" --why "Git 是唯一真相源"',
    );
    expect(out).toContain("adr_0001");
    const yaml = readNode("adr_0001");
    expect(yaml).toContain("status: proposed");
    expect(yaml).toContain("decision:");
    expect(yaml).toContain("why: Git 是唯一真相源");
    const events = fs.readFileSync(path.join(tmpDir, ".graph/events.jsonl"), "utf-8");
    expect(events).toContain("adr_created");

    // 第二篇编号递增
    run('adr create --title "第二个决策" --decision "x"');
    expect(fs.existsSync(path.join(tmpDir, ".graph/nodes/adr_0002.yaml"))).toBe(true);
  });

  it("adr accept：proposed → accepted；list 按状态过滤", () => {
    run("init");
    run('adr create --title "决策一" --decision "d1"');
    run('adr create --title "决策二" --decision "d2"');
    const out = run("adr accept --id adr_0001");
    expect(out).toContain("accepted");
    const list = run("adr list --status accepted");
    expect(list).toContain("adr_0001");
    expect(list).not.toContain("adr_0002");
  });

  it("adr supersede --by 原子完成（状态+接替者）；--by 不存在时拒绝", () => {
    run("init");
    run('adr create --title "旧决策" --decision "old"');
    run('adr create --title "新决策" --decision "new"');
    run("adr accept --id adr_0001");
    run("adr accept --id adr_0002");
    const out = run("adr supersede --id adr_0001 --by adr_0002");
    expect(out).toContain("adr_0002");
    const yaml = readNode("adr_0001");
    expect(yaml).toContain("status: superseded");
    expect(yaml).toContain("superseded_by: adr_0002");

    run('adr create --title "第三" --decision "d3"');
    run("adr accept --id adr_0003");
    const err = runFailArr(["adr", "supersede", "--id", "adr_0003", "--by", "adr_9999"]);
    expect(err).toContain("不存在");
  });

  it("context 顶点拒绝状态变更（update-status 报错）", () => {
    run("init");
    run('create-node --id ctx_1 --type context --label "上下文"');
    const err = runFailArr(["update-status", "--id", "ctx_1", "--status", "ready"]);
    expect(err).toContain("context");
  });
});

describe("v0.5 领域参数", () => {
  it("create-node --context 创建即归属", () => {
    run("init");
    run('create-node --id ctx_1 --type context --label "上下文"');
    run('create-node --id t1 --label 任务 --context ctx_1');
    expect(readNode("t1")).toContain("context: ctx_1");
  });

  it("update-node --set-context/--boundary/--glossary-add", () => {
    run("init");
    run('create-node --id ctx_1 --type context --label "上下文"');
    run('update-node --id ctx_1 --boundary "负责订单；不负责计费"');
    runArr([
      "update-node",
      "--id",
      "ctx_1",
      "--glossary-add",
      '{"term":"订单","definition":"购买单据"}',
    ]);
    const yaml = readNode("ctx_1");
    expect(yaml).toContain("boundary: 负责订单；不负责计费");
    expect(yaml).toContain("term: 订单");

    run('create-node --id t1 --label 任务');
    run("update-node --id t1 --set-context ctx_1");
    expect(readNode("t1")).toContain("context: ctx_1");
    // 空串清除归属
    runArr(["update-node", "--id", "t1", "--set-context", ""]);
    expect(readNode("t1")).not.toContain("context:");
  });

  it("add-edge --type decides/relates + --rel-kind + --contract", () => {
    run("init");
    run('create-node --id ctx_a --type context --label A');
    run('create-node --id ctx_b --type context --label B');
    run('create-node --id t1 --label T1 --context ctx_a');
    run('create-node --id t2 --label T2 --context ctx_b');
    run('adr create --title "决策" --decision "d"');
    run("add-edge --id d1 --source adr_0001 --target t1 --type decides");
    run('add-edge --id r1 --source ctx_a --target ctx_b --type relates --rel-kind "upstream-downstream"');
    runArr([
      "add-edge",
      "--id",
      "e1",
      "--source",
      "t1",
      "--target",
      "t2",
      "--type",
      "depends_on",
      "--contract",
      '{"produces":"订单事件"}',
    ]);
    expect(readNode("ctx_b").length > 0).toBe(true);
    const r1 = fs.readFileSync(path.join(tmpDir, ".graph/edges/r1.yaml"), "utf-8");
    expect(r1).toContain("relates");
    expect(r1).toContain("rel_kind: upstream-downstream");
    const e1 = fs.readFileSync(path.join(tmpDir, ".graph/edges/e1.yaml"), "utf-8");
    expect(e1).toContain("produces: 订单事件");
    // 契约边齐备 → validate 无跨 context 契约/领域类警告（entry/exit 为空的既有警告不算）
    const v = run("validate --json");
    const domainWarnings = (JSON.parse(v).warnings as string[]).filter(
      (w) => w.includes("contract") || w.includes("context") || w.includes("relates") || w.includes("decides"),
    );
    expect(domainWarnings).toHaveLength(0);
  });
});

describe("v0.5 graph export", () => {
  it("ADR → docs/adr/NNNN-slug.md；context → CONTEXT-MAP.md + docs/contexts/", () => {
    run("init");
    run('adr create --title "纯文件系统存储" --decision "YAML 落盘" --why "Git 是真相源"');
    run("adr accept --id adr_0001");
    run('create-node --id ctx_1 --type context --label "订单上下文"');
    run('update-node --id ctx_1 --boundary "订单生命周期"');
    runArr([
      "update-node",
      "--id",
      "ctx_1",
      "--glossary-add",
      '{"term":"订单","definition":"购买单据"}',
    ]);

    const out = run("export --docs");
    expect(out).toContain("1 篇 ADR");
    expect(out).toContain("1 个 context");

    const adrFiles = fs.readdirSync(path.join(tmpDir, "docs/adr"));
    expect(adrFiles[0]).toMatch(/^0001-.*\.md$/);
    const adrMd = fs.readFileSync(path.join(tmpDir, "docs/adr", adrFiles[0]), "utf-8");
    expect(adrMd).toContain("# 0001 — 纯文件系统存储");
    expect(adrMd).toContain("**Status：** accepted");
    expect(adrMd).toContain("**Why：** Git 是真相源");

    expect(fs.existsSync(path.join(tmpDir, "CONTEXT-MAP.md"))).toBe(true);
    const ctxMd = fs.readFileSync(path.join(tmpDir, "docs/contexts/ctx_1.md"), "utf-8");
    expect(ctxMd).toContain("订单上下文");
    expect(ctxMd).toContain("- **订单**: 购买单据");
    // 根 CONTEXT.md 不受影响（不生成）
    expect(fs.existsSync(path.join(tmpDir, "CONTEXT.md"))).toBe(false);
  });
});
