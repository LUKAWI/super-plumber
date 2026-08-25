// tests/web/server-hardening.test.ts
// S0-5/S3-7 回归：web 服务安全加固。
// S0-5：listen 显式绑 127.0.0.1（不再 0.0.0.0/:: 暴露局域网）；内部错误脱敏。
// S3-7：静态服务 exists→read 竞态不再把同步异常抛进 http handler（曾可击穿进程）。
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { startServer } from "../../src/web/server.js";
import { createGraph } from "../../src/core/graph-dir.js";

// WEB-05 用：条件故障注入（race.armed 置 true 后 readFileSync 一律 ENOENT，
// 模拟"exists 检查通过后、读取前文件被删"的竞态窗口）。vi.mock 提升到模块顶部，
// 工厂在 node:fs 首次被导入时执行，闭包读取 race 在请求期才发生，TDZ 安全。
const race = { armed: false };
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: (actual as unknown as { default?: object }).default ?? actual,
    readFileSync: ((...args: Parameters<typeof fs.readFileSync>) => {
      if (race.armed) {
        const e = new Error("ENOENT: simulated race") as NodeJS.ErrnoException;
        e.code = "ENOENT";
        throw e;
      }
      return actual.readFileSync(...args);
    }) as typeof fs.readFileSync,
  };
});

let tmpDir: string;
let server: ReturnType<typeof startServer>;
let port: number;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-webhard-"));
  createGraph(tmpDir, "t", "测试图");
  server = startServer(tmpDir, 0, { open: false });
  await new Promise<void>((resolve) => server.server.once("listening", resolve));
  const addr = server.server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  port = addr.port;
});

afterAll(async () => {
  server.watcher.close();
  server.wss.close();
  await new Promise<void>((resolve) => server.server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 原生 http 请求（不规范化 URL——fetch 会把 %2e%2e 解析成 .. 再发请求） */
function rawGet(pathname: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: pathname },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
  });
}

describe("web 服务安全加固（S0-5/S3-7）", () => {
  it("WEB-01 仅监听 127.0.0.1（绑定面验证）", () => {
    const addr = server.server.address();
    expect(addr && typeof addr === "object").toBe(true);
    expect((addr as { address: string }).address).toBe("127.0.0.1");
  });

  it("WEB-02 内部错误脱敏：/api/diff 坏快照 id → 500 通用消息，不回显内部 detail", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/diff?graph=t&against=no-such-snap`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("内部错误");
    expect(body.error).not.toContain("Snapshot no-such-snap"); // 内部异常消息不外泄
  });

  it("WEB-03 路径穿越仍被 403 拦截（原始编码路径直达服务端）", async () => {
    const r = await rawGet("/%2e%2e/%2e%2e/etc/passwd");
    expect(r.status).toBe(403);
  });

  it("WEB-04 未知路径回退 SPA index.html（原行为保留）", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/no-such-route`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("WEB-05 静态读取竞态返回 500、进程存活（S3-7）", async () => {
    race.armed = true;
    const res = await fetch(`http://127.0.0.1:${port}/index.html`);
    expect(res.status).toBe(500);
    race.armed = false;
    // 进程未崩：下一个请求正常服务
    const ok = await fetch(`http://127.0.0.1:${port}/index.html`);
    expect(ok.status).toBe(200);
  });
});
