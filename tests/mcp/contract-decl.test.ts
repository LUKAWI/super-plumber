// tests/mcp/contract-decl.test.ts
// IL-012：MCP 双通道——graph_update_node 的 contract_add 声明 context 对默认契约，
// 跨 context 工作流边自动继承（graph_validate 不再警告）；单边 contract 覆写仍合法。
// 断言针对 dist 构建（vitest 前置 npm run build），与既有 MCP 测试同构。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

const SDK = "@modelcontextprotocol/sdk";

async function connectServer(cwd: string) {
  const { Client } = await import(`${SDK}/client/index.js`);
  const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);
  const serverJs = path.resolve(process.cwd(), "dist/mcp/server.js");
  const transport = new StdioClientTransport({ command: "node", args: [serverJs], cwd });
  const client = new Client({ name: "test-il012", version: "0.1.1" });
  await client.connect(transport);
  return client;
}

function parseBody(r: { content?: { text?: string }[] }): Record<string, any> {
  return JSON.parse(r.content![0].text!);
}

describe("IL-012 MCP contract_add（context 对默认契约声明）", () => {
  let tmpDir: string;
  let client: Awaited<ReturnType<typeof connectServer>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-il012-"));
    const cli = path.resolve(process.cwd(), "dist/cli/index.js");
    execSync(`node "${cli}" init t`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id ctx_a --type context --label "A"`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id ctx_b --type context --label "B"`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id t1 --label "任务1" --context ctx_a`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id t2 --label "任务2" --context ctx_b`, { cwd: tmpDir });
    execSync(`node "${cli}" create-node --id t3 --label "任务3" --context ctx_b`, { cwd: tmpDir });
    // 跨 context 边，无 contract：改造前会告警
    execSync(`node "${cli}" add-edge --id e1 --source t1 --target t2 --type depends_on`, { cwd: tmpDir });
    client = await connectServer(tmpDir);
  });

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("C1 声明前 graph_validate 警告该集成点；contract_add 声明后继承生效、警告消失", async () => {
    const before = parseBody(
      await client.callTool({ name: "graph_validate", arguments: {} }),
    );
    expect(
      (before.warnings as string[]).some((w: string) => w.includes("e1") && w.includes("contract")),
    ).toBe(true);

    const decl = parseBody(
      await client.callTool({
        name: "graph_update_node",
        arguments: {
          id: "ctx_a",
          contract_add: [
            {
              to: "ctx_b",
              contract: {
                produces: "任务1产物",
                consumed_by: [{ artifact: "任务1产物", used_as: "任务2输入" }],
              },
            },
          ],
        },
      }),
    );
    expect(decl.contracts).toHaveLength(1);
    expect(decl.contracts[0].to).toBe("ctx_b");

    const after = parseBody(
      await client.callTool({ name: "graph_validate", arguments: {} }),
    );
    expect(after.ok).toBe(true);
    expect((after.warnings as string[]).some((w: string) => w.includes("contract"))).toBe(false);
  });

  it("C2 graph_get_node 读回 contracts 声明（双通道落盘一致）", async () => {
    const node = parseBody(
      await client.callTool({ name: "graph_get_node", arguments: { id: "ctx_a" } }),
    );
    const contracts = node.node?.contracts ?? node.contracts;
    expect(contracts).toBeDefined();
    expect(contracts[0].to).toBe("ctx_b");
    expect(contracts[0].contract.produces).toBe("任务1产物");
  });

  it("C3 存量路径：graph_add_edge 带 contract 仍合法（单边覆写/逐边契约向后兼容）", async () => {
    // 反向集成点（ctx_b → ctx_a）由单边 contract 覆盖（t3→t1，避免与 e1 成拓扑环）
    const edge = parseBody(
      await client.callTool({
        name: "graph_add_edge",
        arguments: {
          id: "e2",
          source: "t3",
          target: "t1",
          type: "depends_on",
          contract: {
            produces: "任务3产物",
            consumed_by: [{ artifact: "任务3产物", used_as: "任务1输入" }],
            validation: { required: true, method: "auto" },
          },
        },
      }),
    );
    expect(edge.contract.produces).toBe("任务3产物");
    const out = parseBody(
      await client.callTool({ name: "graph_validate", arguments: {} }),
    );
    expect(out.ok).toBe(true);
    // 不因 ctx_b 无声明而告警（单边 contract 优先于 context 对声明）
    expect((out.warnings as string[]).some((w: string) => w.includes("e2"))).toBe(false);
  });
});
