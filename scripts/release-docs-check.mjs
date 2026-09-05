#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_ENTRY = path.join(REPO_ROOT, "dist", "cli", "index.js");

function hasGraph(root) {
  const dotGraph = path.join(root, ".graph");
  if (!fs.existsSync(dotGraph)) return false;
  if (fs.existsSync(path.join(dotGraph, "graph.yaml"))) return true;
  return fs.readdirSync(dotGraph, { withFileTypes: true }).some(
    (entry) => entry.isDirectory() && fs.existsSync(path.join(dotGraph, entry.name, "graph.yaml")),
  );
}

function runCli(args, cwd) {
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`graph ${args.join(" ")} 退出码 ${result.status ?? 1}`);
  }
}

function run() {
  let fixtureRoot = null;
  const root = hasGraph(REPO_ROOT)
    ? REPO_ROOT
    : (fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "super-plumber-docs-gate-")));

  try {
    if (fixtureRoot) {
      console.log("当前检出树没有 .graph；使用临时最小图执行 docs export check，不跳过文档门禁。");
      runCli(["init", "release-docs-fixture", "--label", "release docs fixture"], root);
      runCli(["export", "--docs"], root);
    }
    runCli(["export", "--docs", "--check"], root);
    console.log("graph docs export check 通过。");
  } finally {
    if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

run();
