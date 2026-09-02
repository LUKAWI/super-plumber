// tests/sync-commands.test.ts — v091-class-command（adr_0016）：commands 3→4 的 sync 传导断言
// 组织方式说明：仓库此前无独立 sync 测试（sync 语义由 scripts/sync-integrations.mjs 的
// --check 门禁承载，prepublishOnly 挂点）。本文件按任务约定不运行 sync 脚本本身，只断言：
//   1) 脚本逻辑：commands 登记是 glob 驱动（dir 'commands' + filter .endsWith('.md')）——
//      第 4 个命令正本落 integrations/shared/commands/ 即自动纳入拷贝计划与 --check 断言，
//      登记清单无需（也不应）手改脚本；
//   2) 正本清单：integrations/shared/commands/ 恰为四个命令正本（3 既有 + plumber-class）；
//   3) 正本结构：plumber-class.md 具备命令正本四要素（frontmatter/同步注释块/执行指令含
//      --by user 凭据/非法档位三值提示）；
//   4) 传导一致性：integrations/plugin/commands/ 拷贝件一旦在位（编排方跑 sync 后）必须与
//      正本 sha256 一致——缺失在传导前是合法中间态（--check 会拦在发布门禁），在位即校验。
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

// 与既有 CLI/MCP 测试同构：以 vitest 运行 cwd（仓库根）为基准解析仓库内路径
const SHARED_COMMANDS = path.resolve("integrations", "shared", "commands");
const PLUGIN_COMMANDS = path.resolve("integrations", "plugin", "commands");
const SYNC_SCRIPT = path.resolve("scripts", "sync-integrations.mjs");

const CANONICAL_COMMANDS = [
  "plumber-class.md",
  "plumber-design.md",
  "plumber-execute.md",
  "plumber-join.md",
];

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

describe("v091 sync 传导：commands 3→4", () => {
  it("脚本 commands 登记为 glob 驱动：新命令无需改脚本即被拷贝计划与 --check 覆盖", () => {
    const src = fs.readFileSync(SYNC_SCRIPT, "utf-8");
    // commands 条目三要素：dir 'commands'、filter 按扩展名（非点名清单）、目标 integrations/plugin/commands
    expect(src).toContain("dir: 'commands'");
    expect(src).toContain("(name) => name.endsWith('.md')");
    expect(src).toContain("'integrations/plugin/commands'");
    // 目标数组只此一处（每个正本恰一个拷贝位），无逐命令点名
    const commandsEntry = src.slice(src.indexOf("dir: 'commands'"), src.indexOf("sp-scripts"));
    expect(commandsEntry).toContain('targets: [');
    expect(commandsEntry).not.toContain("plumber-");
  });

  it("正本清单恰为四个命令：3 既有 + plumber-class（缺一多一都不行）", () => {
    const files = fs
      .readdirSync(SHARED_COMMANDS)
      .filter((f) => f.endsWith(".md"))
      .sort();
    expect(files).toEqual([...CANONICAL_COMMANDS].sort());
  });

  it("plumber-class.md 正本结构：frontmatter + 同步注释块 + 执行指令凭据 + 三值提示", () => {
    const body = fs.readFileSync(path.join(SHARED_COMMANDS, "plumber-class.md"), "utf-8");
    // frontmatter description（其他三个正本同款开场）
    expect(body.startsWith("---\ndescription: ")).toBe(true);
    // 构建期同步注释块：正本唯一性 + 拷贝目标
    expect(body).toContain("正本唯一性：本文件是 /plumber-class 文案的唯一权威源");
    expect(body).toContain("integrations/plugin/commands/plumber-class.md");
    expect(body).toContain("禁止手改拷贝件");
    // 命令本体四要素：标题 / 定位 / 执行指令 / 参数位说明
    expect(body).toContain("# /plumber-class");
    expect(body).toContain("**定位**：");
    expect(body).toContain("**执行指令**：");
    expect(body).toContain("**参数位说明**：$ARGUMENTS 原样透传");
    // 核心凭据语义：--by user 必带 + 回显生效（graph status 可查）+ 非法档位三值提示
    expect(body).toContain("graph update-graph --class <档> --by user");
    expect(body).toContain("graph status");
    expect(body).toContain("quick | standard | program");
  });

  it("传导一致性：插件包拷贝件在位即与正本 sha256 一致（缺失=待编排方传导，--check 发布门禁兜底）", () => {
    for (const f of CANONICAL_COMMANDS) {
      const canonical = path.join(SHARED_COMMANDS, f);
      const copy = path.join(PLUGIN_COMMANDS, f);
      expect(fs.existsSync(canonical), `正本 ${f} 在位`).toBe(true);
      if (fs.existsSync(copy)) {
        expect(sha256(copy), `拷贝件 ${f} 漂移`).toBe(sha256(canonical));
      }
    }
  });
});
