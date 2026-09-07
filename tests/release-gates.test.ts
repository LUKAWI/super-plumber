import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

type ReleaseVersionModule = typeof import("../scripts/release-version-check.mjs");
type ReleaseTestsModule = typeof import("../scripts/run-release-tests.mjs");
type ReleaseGatesModule = typeof import("../scripts/release-gates.mjs");
type PluginDependencyModule = typeof import("../scripts/plugin-dependency-check.mjs");

let checkReleaseVersions: ReleaseVersionModule["checkReleaseVersions"];
let collectVersionRecords: ReleaseVersionModule["collectVersionRecords"];
let inspectCoverageSummary: ReleaseTestsModule["inspectCoverageSummary"];
let inspectReleaseTestReport: ReleaseTestsModule["inspectReleaseTestReport"];
let createReleaseSteps: ReleaseGatesModule["createReleaseSteps"];
let checkPinnedPluginDependencies: PluginDependencyModule["checkPinnedPluginDependencies"];

// Vitest 2 的静态收集会把带 shebang 的 .mjs 当作内联源码解析并报
// "Invalid or unexpected token"。这里通过 Node 原生 ESM seam 装载真实发布脚本；
// 测试仍直接断言其导出行为，不复制实现，也不降低发布协议。
const nativeImport = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);
let moduleFixtureRoot: string;

beforeAll(async () => {
  moduleFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-gates-modules-"));
  const load = async <T>(relativePath: string): Promise<T> => {
    const source = fs.readFileSync(path.resolve(relativePath), "utf8").replace(/^#!.*\r?\n/, "");
    const fixture = path.join(moduleFixtureRoot, path.basename(relativePath));
    fs.writeFileSync(fixture, source);
    return (await nativeImport(pathToFileURL(fixture).href)) as T;
  };
  const versions = await load<ReleaseVersionModule>("scripts/release-version-check.mjs");
  const releaseTests = await load<ReleaseTestsModule>("scripts/run-release-tests.mjs");
  const releaseGates = await load<ReleaseGatesModule>("scripts/release-gates.mjs");
  const pluginDependencies = await load<PluginDependencyModule>("scripts/plugin-dependency-check.mjs");

  ({ checkReleaseVersions, collectVersionRecords } = versions);
  ({ inspectCoverageSummary, inspectReleaseTestReport } = releaseTests);
  ({ createReleaseSteps } = releaseGates);
  ({ checkPinnedPluginDependencies } = pluginDependencies);
});

afterAll(() => {
  fs.rmSync(moduleFixtureRoot, { recursive: true, force: true });
});

describe("1.0.0 release version gate", () => {
  const tempRoots: string[] = [];

  function createReleaseRunnerFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-runner-process-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.copyFileSync(
      path.resolve("scripts", "run-release-tests.mjs"),
      path.join(root, "scripts", "run-release-tests.mjs"),
    );
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ type: "module", scripts: { test: "node fake-vitest.mjs" } }),
    );
    fs.writeFileSync(
      path.join(root, "fake-vitest.mjs"),
      `import fs from "node:fs";
import path from "node:path";

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const mode = process.env.RELEASE_RUNNER_FIXTURE_MODE;
if (mode !== "missing-report") {
  const reportFile = valueAfter("--outputFile");
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify({
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numTotalTests: 1,
    numPassedTests: 1,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [{
      name: path.join(process.cwd(), "tests", "collected.test.ts"),
      assertionResults: [{ status: "passed" }],
    }],
  }));
}
if (mode === "bad-coverage") {
  const coverageDir = valueAfter("--coverage.reportsDirectory");
  fs.mkdirSync(coverageDir, { recursive: true });
  fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify({
    total: {
      lines: { pct: 0 },
      functions: { pct: 100 },
      branches: { pct: 100 },
    },
  }));
}
`,
    );
    return root;
  }

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["关键文件未收集", "missing-critical", ["--critical-file", "tests/required.test.ts"], "关键测试文件未被收集"],
    ["JSON 报告缺失", "missing-report", [], "Vitest 未生成 JSON 测试报告"],
    [
      "coverage 校验失败",
      "bad-coverage",
      ["--coverage", "--coverage-include", "fake-vitest.mjs", "--coverage-min-lines", "1"],
      "coverage 行覆盖率",
    ],
  ])("Vitest 退出 0 后%s仍让 runner 非零退出", (_label, mode, args, expectedError) => {
    const root = createReleaseRunnerFixture();
    const runner = path.join(root, "scripts", "run-release-tests.mjs");
    const result = spawnSync(process.execPath, [runner, "--project", "root", ...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, RELEASE_RUNNER_FIXTURE_MODE: mode },
    });

    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain(expectedError);
  });

  it("checks package-lock roots and every release manifest against package.json", () => {
    const result = checkReleaseVersions(process.cwd());

    expect(result.ok).toBe(true);
    expect(result.sourceVersion).toBe("1.0.0");
    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "package-lock.json", location: "version", value: "1.0.0" }),
        expect.objectContaining({ file: "package-lock.json", location: "packages[\"\"].version", value: "1.0.0" }),
        expect.objectContaining({ file: ".claude-plugin/marketplace.json", location: "version", value: "1.0.0" }),
        expect.objectContaining({ file: ".agents/plugins/marketplace.json", location: "plugins[0].version", value: "1.0.0" }),
        expect.objectContaining({ file: "integrations/plugin/.claude-plugin/plugin.json", location: "version", value: "1.0.0" }),
        expect.objectContaining({ file: "integrations/plugin/.codex-plugin/plugin.json", location: "version", value: "1.0.0" }),
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
      "S级问题账本审计",
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
    expect(steps.find((step) => step.label === "root test + 关键 coverage")?.args).toEqual(
      expect.arrayContaining([
        "tests/cli/approve-cli.test.ts",
        "tests/cli/class-command-cli.test.ts",
        "tests/cli/fog-cli.test.ts",
        "tests/cli/q3-flow-economy.test.ts",
        "tests/mcp/approve-mcp.test.ts",
        "tests/mcp/class-command-mcp.test.ts",
        "tests/mcp/e2e-agent-loop.test.ts",
        "tests/mcp/fog-mcp.test.ts",
        "tests/mcp/phase3.test.ts",
        "tests/mcp/tools-coverage.test.ts",
      ]),
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
    expect(result.packageSpec).toBe("@lukawi/super-plumber@1.0.0");
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
      JSON.stringify({ name: "@lukawi/super-plumber", version: "1.0.0" }),
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
