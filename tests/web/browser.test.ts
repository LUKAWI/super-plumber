// tests/web/browser.test.ts
// openBrowser 平台分发测试：验证三个平台的浏览器打开命令正确
import { describe, it, expect, vi } from "vitest";
import { openBrowser } from "../../src/web/server.js";

describe("openBrowser", () => {
  function fakeSpawn() {
    return { on: vi.fn(), unref: vi.fn() };
  }

  it("win32 用 cmd /c start（含空标题占位）", () => {
    const child = fakeSpawn();
    const spy = vi.fn(() => child);
    openBrowser("http://localhost:8934", "win32", spy as never);
    expect(spy).toHaveBeenCalledWith(
      "cmd",
      ["/c", "start", "", "http://localhost:8934"],
      expect.objectContaining({ detached: true }),
    );
  });

  it("darwin 用 open", () => {
    const spy = vi.fn(() => fakeSpawn());
    openBrowser("http://localhost:8934", "darwin", spy as never);
    expect(spy).toHaveBeenCalledWith(
      "open",
      ["http://localhost:8934"],
      expect.objectContaining({ detached: true }),
    );
  });

  it("linux 用 xdg-open", () => {
    const spy = vi.fn(() => fakeSpawn());
    openBrowser("http://localhost:8934", "linux", spy as never);
    expect(spy).toHaveBeenCalledWith(
      "xdg-open",
      ["http://localhost:8934"],
      expect.objectContaining({ detached: true }),
    );
  });

  it("spawn 失败（无 xdg-open 等）不抛出", () => {
    const spy = vi.fn(() => {
      throw new Error("ENOENT");
    });
    expect(() =>
      openBrowser("http://localhost:8934", "linux", spy as never),
    ).not.toThrow();
  });
});
