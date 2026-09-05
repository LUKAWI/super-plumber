import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  checkReleaseVersions,
  collectVersionRecords,
} from "../scripts/release-version-check.mjs";
import { inspectCoverageSummary, inspectReleaseTestReport } from "../scripts/run-release-tests.mjs";
import { createReleaseSteps } from "../scripts/release-gates.mjs";
import { checkPinnedPluginDependencies } from "../scripts/plugin-dependency-check.mjs";

describe("0.9.7 release version gate", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("checks package-lock roots and every release manifest against package.json", () => {
    const result = checkReleaseVersions(process.cwd());

    expect(result.ok).toBe(true);
    expect(result.sourceVersion).toBe("0.9.7");
    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "package-lock.json", location: "version", value: "0.9.7" }),
        expect.objectContaining({ file: "package-lock.json", location: "packages[\"\"].version", value: "0.9.7" }),
        expect.objectContaining({ file: ".claude-plugin/marketplace.json", location: "version", value: "0.9.7" }),
        expect.objectContaining({ file: ".agents/plugins/marketplace.json", location: "plugins[0].version", value: "0.9.7" }),
        expect.objectContaining({ file: "integrations/plugin/.claude-plugin/plugin.json", location: "version", value: "0.9.7" }),
        expect.objectContaining({ file: "integrations/plugin/.codex-plugin/plugin.json", location: "version", value: "0.9.7" }),
      ]),
    );
  });

  it("reports a lockfile drift instead of treating package.json as sufficient", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-version-gate-"));
    tempRoots.push(root);

    for (const file of [
      "package.json",
      "package-lock.json",
      ".claude-plugin/marketplace.json",
      ".agents/plugins/marketplace.json",
      "integrations/plugin/.claude-plugin/plugin.json",
      "integrations/plugin/.codex-plugin/plugin.json",
    ]) {
      const source = path.resolve(file);
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }

    const lockfile = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    lockfile.packages[""].version = "0.9.5";
    fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(lockfile));

    const result = checkReleaseVersions(root);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "package-lock.json",
          location: 'packages[""].version',
          value: "0.9.5",
        }),
      ]),
    );
  });

  it("turns a skipped suite into a release-gate failure", () => {
    expect(() =>
      inspectReleaseTestReport(
        {
          numTotalTestSuites: 1,
          numPendingTestSuites: 1,
          numTotalTests: 0,
          numPendingTests: 0,
          numTodoTests: 0,
          testResults: [],
        },
        { projectRoot: process.cwd() },
      ),
    ).toThrow("跳过");
  });

  it("requires every named critical test file to be collected", () => {
    expect(() =>
      inspectReleaseTestReport(
        {
          numTotalTestSuites: 1,
          numPassedTestSuites: 1,
          numTotalTests: 1,
          numPassedTests: 1,
          numPendingTests: 0,
          numTodoTests: 0,
          testResults: [
            {
              name: path.resolve("tests", "release-gates.test.ts"),
              assertionResults: [{ status: "passed" }],
            },
          ],
        },
        {
          projectRoot: process.cwd(),
          criticalFiles: ["tests/core/style-lint.test.ts"],
        },
      ),
    ).toThrow("关键测试文件");
  });

  it("requires a real numeric coverage report above the configured line threshold", () => {
    const belowThreshold = {
      total: { lines: { pct: 39.99 }, functions: { pct: 50 }, branches: { pct: 60 } },
    };
    const passing = {
      total: { lines: { pct: 40 }, functions: { pct: 50 }, branches: { pct: 60 } },
    };
    expect(() => inspectCoverageSummary(belowThreshold, { minimumLines: 40 })).toThrow("低于门槛");
    expect(() => inspectCoverageSummary(passing, { minimumLines: 40 })).not.toThrow();
  });

  it("declares root/UI tests, typechecks, builds, sync, and docs export in prepublish order", () => {
    const steps = createReleaseSteps(process.cwd());
    const labels = steps.map((step) => step.label);
    const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));

    expect(packageJson.scripts.prepublishOnly).toBe("node scripts/release-gates.mjs");

    expect(labels).toEqual([
      "版本单一来源（package.json/package-lock/manifest）",
      "插件 npx 依赖精确版本",
      "root typecheck",
      "root build",
      "发布 CLI/MCP 构建物存在",
      "root test + 关键 coverage",
      "web-ui typecheck",
      "web-ui build",
      "web-ui test + 关键 coverage",
      "integrations gen/sync check",
      "graph docs export check",
    ]);
    expect(steps.find((step) => step.label === "root test + 关键 coverage")?.args).toContain("tests/core/style-lint.test.ts");
    expect(steps.find((step) => step.label === "root test + 关键 coverage")?.args).toEqual(
      expect.arrayContaining(["--coverage", "--coverage-min-lines", "40", "--coverage-include", "src/core/graph-dir.ts"]),
    );
    expect(steps.find((step) => step.label === "root test + 关键 coverage")?.args).toEqual(
      expect.arrayContaining(["tests/cli/sp-script.test.ts", "tests/cli/sp-targeting.test.ts"]),
    );
    expect(steps.find((step) => step.label === "web-ui test + 关键 coverage")?.args).toContain("src/lib/render-smoke.test.ts");
    expect(steps.find((step) => step.label === "web-ui test + 关键 coverage")?.args).toEqual(
      expect.arrayContaining(["--coverage", "--coverage-min-lines", "60", "--coverage-include", "src/components/GraphCanvas.svelte"]),
    );
    expect(steps.find((step) => step.label === "integrations gen/sync check")?.args).toEqual([
      "scripts/sync-integrations.mjs",
      "--check",
    ]);
    expect(steps.find((step) => step.label === "graph docs export check")?.args).toEqual([
      "scripts/release-docs-check.mjs",
    ]);
  });

  it("does not hide the CLI validation suite behind conditional skipping", () => {
    const source = fs.readFileSync(path.resolve("tests", "core", "style-lint.test.ts"), "utf8");
    expect(source).not.toContain("describe." + "skip" + "If");
    expect(
      createReleaseSteps(process.cwd()).find((step) => step.label === "发布 CLI/MCP 构建物存在")?.requiredFiles,
    ).toEqual(["dist/cli/index.js", "dist/mcp/server.js"]);
  });

  it("requires plugin MCP launchers to pin the package version", () => {
    const result = checkPinnedPluginDependencies(process.cwd());

    expect(result.ok).toBe(true);
    expect(result.packageSpec).toBe("@lukawi/super-plumber@0.9.7");
    expect(result.checked).toEqual([
      "integrations/plugin/.mcp.json",
      "integrations/plugin/.codex-plugin/plugin.json",
    ]);
  });

  it("records unpinned and stale specs as upgrade failures", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-dependency-gate-"));
    tempRoots.push(root);
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@lukawi/super-plumber", version: "0.9.7" }),
    );
    for (const file of ["integrations/plugin/.mcp.json", "integrations/plugin/.codex-plugin/plugin.json"]) {
      const source = path.resolve(file);
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const config = JSON.parse(fs.readFileSync(source, "utf8"));
      if (file.endsWith(".mcp.json")) {
        config.mcpServers["graph-mcp"].args[1] = "@lukawi/super-plumber";
      } else {
        config.mcpServers["graph-mcp"].args[1] = "@lukawi/super-plumber@0.9.5";
      }
      fs.writeFileSync(target, JSON.stringify(config));
    }

    const result = checkPinnedPluginDependencies(root);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "integrations/plugin/.mcp.json" }),
        expect.objectContaining({ file: "integrations/plugin/.codex-plugin/plugin.json" }),
      ]),
    );
  });
});
