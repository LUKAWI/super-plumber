// tests/sync-commands.test.ts — commands 正本到两份渠道视图的 sync 传导断言
// sync 语义由 scripts/sync-integrations.mjs 的 --check 门禁承载；本文件不运行脚本本身，只断言：
//   1) 脚本逻辑：commands 登记是 glob 驱动（dir 'commands' + filter .endsWith('.md')）——
//      新命令正本落 integrations/src/commands/ 即自动纳入两份生成视图与 --check 断言，
//      登记清单无需（也不应）手改脚本；
//   2) 正本清单：integrations/src/commands/ 恰为四个公开命令；
//   3) 统一入口 plumber.md 保留只读路由和三档语义；
//   4) 传导一致性：shared/plugin 两份生成视图必须与 src 正本逐字节一致。
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SOURCE_COMMANDS = path.resolve("integrations", "src", "commands");
const SHARED_COMMANDS = path.resolve("integrations", "shared", "commands");
const PLUGIN_COMMANDS = path.resolve("integrations", "plugin", "commands");
const SYNC_SCRIPT = path.resolve("scripts", "sync-integrations.mjs");

const CANONICAL_COMMANDS = [
  "plumber-design.md",
  "plumber-execute.md",
  "plumber-join.md",
  "plumber.md",
];

describe("commands 单真相源传导", () => {
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

  it("正本清单恰为四个公开命令：统一入口 + 三个直达入口", () => {
    const files = fs
      .readdirSync(SOURCE_COMMANDS)
      .filter((f) => f.endsWith(".md"))
      .sort();
    expect(files).toEqual([...CANONICAL_COMMANDS].sort());
  });

  it("plumber.md 正本结构：frontmatter + 单真相源注释 + 只读路由 + 三档提示", () => {
    const body = fs.readFileSync(path.join(SOURCE_COMMANDS, "plumber.md"), "utf-8");
    expect(body).toMatch(/^---\r?\ndescription: /);
    expect(body).toContain("命令正本：integrations/src/commands/plumber.md");
    expect(body).toContain("# /plumber");
    expect(body).toContain("只给只读路由提示");
    expect(body).toContain("quick|standard|program");
    expect(body).toContain("/plumber-design");
    expect(body).toContain("/plumber-execute");
    expect(body).toContain("/plumber-join");
  });

  it("传导一致性：shared/plugin 两份生成视图与 src 正本逐字节一致", () => {
    for (const f of CANONICAL_COMMANDS) {
      const canonical = fs.readFileSync(path.join(SOURCE_COMMANDS, f));
      expect(fs.readFileSync(path.join(SHARED_COMMANDS, f))).toEqual(canonical);
      expect(fs.readFileSync(path.join(PLUGIN_COMMANDS, f))).toEqual(canonical);
    }
  });
});
