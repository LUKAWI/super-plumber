#!/usr/bin/env node
// sp.mjs — super-plumber 执行脚本单入口（0.9.4 S03 八脚本收敛，adr_0008 单真相源重组）
//
// 定位：无 MCP 环境的便利层，不再是第三套真相——
//   - 有 CLI 面的子命令（claim / update-status / get-node）：只做参数组装 → 调 CLI
//     （定位 @lukawi/super-plumber 的 dist/cli/index.js）→ stdio/退出码透传，语义 ≡ CLI；
//   - CLI 尚无对应子命令的（checkpoint / report / traverse）：单点调用与 CLI/MCP 同一的
//     核心公开 API（@lukawi/super-plumber/core），本地零语义加工——状态机/门禁/上限都在核心层强制；
//   - check-design：转发给同目录 sp-check-design.mjs（设计体检 doctor，判据见手册 §2.6）。
// 历史注记：旧 sp-{core,claim,update-status,checkpoint,report,get-node,traverse}.mjs 七件
//   连同各自的入口语义层在本收敛中退役；IL-017 traverse 语义（输出形状/上限/截断记账）原样保留。
//
// Usage: node sp.mjs [--graph <name>] <subcommand> [args...]   （从含 .graph/ 的工作区根目录运行）
//
// 子命令：
//   claim <node_id> <claim_by> [--graph <name>]
//       ready→running 原子认领（≡ CLI `graph update-status -i <id> -s running --claim-by`）。
//   update-status <node_id> <pending|ready|running|passed|failed|blocked|cancelled> [--force] [--graph <name>]
//       状态机校验的状态流转（≡ CLI `graph update-status`）。
//   checkpoint <node_id> <checkpoint_id> <pending|running|passed|failed|skipped> [--graph <name>]
//       上报一个 checkpoint（幂等；随做随报，绝不攒批）。
//   report <node_id> <summary> [artifacts.csv] [blockers.csv] [notes] [--graph <name>]
//       提交 execution_report（artifacts 只写真实文件路径）。
//   get-node <node_id> [--graph <name>]
//       输出节点完整内容（≡ CLI `graph get-node`，含合法转换/门禁状态/管辖 ADR 指针）。
//   traverse <node_id> [downstream|upstream|both] [max_depth] [--graph <name>]
//       从指定节点遍历邻居；语义 ≡ MCP graph_traverse（IL-017）：缺省 depth 3、上限 50，
//       max_nodes 固定 200，输出 { nodes, truncated, truncated_by_depth, truncated_by_nodes } JSON 一行。
//   check-design [--json] [root] [--graph <name>]
//       设计质量体检 doctor（E1-E10/W1-W8 判据，手册 §2.6）；转发同目录 sp-check-design.mjs。
//
// 零依赖：仅 node 内置（先包内/源码树，再项目本地安装，最后回退 npm root -g）。
import { createRequire } from "node:module";
import fs from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const PKG_NAME = "@lukawi/super-plumber";

const USAGE = `Usage: node sp.mjs [--graph <name>] <subcommand> [args...]

子命令（无 MCP 环境的便利层，语义 ≡ CLI / MCP）:
  claim         <node_id> <claim_by> [--graph <name>] ready→running 原子认领
  update-status <node_id> <status> [--force] [--graph <name>] 状态流转（pending|ready|running|passed|failed|blocked|cancelled）
  checkpoint    <node_id> <cp_id> <status> [--graph <name>] 上报一个 checkpoint（pending|running|passed|failed|skipped）
  report        <node_id> <summary> [artifacts.csv] [blockers.csv] [notes] [--graph <name>]
                                                      提交 execution_report
  get-node      <node_id> [--graph <name>]             输出节点完整内容
  traverse      <node_id> [downstream|upstream|both] [max_depth] [--graph <name>]
                                                      遍历邻居（缺省 depth 3、上限 50）
  check-design  [--json] [root] [--graph <name>]       设计质量体检（手册 §2.6）

目标图优先级：显式 --graph > SUPER_PLUMBER_GRAPH > .graph/active > default。`;

// ---------------------------------------------------------------------------
// 解析：优先项目本地安装 / 包内自引用（nearest package.json name 匹配即包根），
// 回退 npm root -g 全局安装。跨平台，零依赖。
// ---------------------------------------------------------------------------

/** 从包内某 dist 文件向上找包根（package.json 的 name === PKG_NAME）。 */
function packageRootOf(distFile) {
	let dir = path.dirname(distFile);
	for (let i = 0; i < 12; i++) {
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		const pkgPath = path.join(parent, "package.json");
		if (fsExists(pkgPath)) {
			try {
				if (JSON.parse(fs.readFileSync(pkgPath, "utf8")).name === PKG_NAME) {
					return parent;
				}
			} catch {
				// package.json 不可解析 → 继续向上
			}
		}
		dir = parent;
	}
	return null;
}

function fsExists(p) {
	try {
		fs.statSync(p);
		return true;
	} catch {
		return false;
	}
}

/** 从脚本所在目录向上寻找当前分发树的包根。 */
function bundledPackageRoot(startDir) {
	let dir = path.resolve(startDir);
	for (let i = 0; i < 12; i++) {
		const distFile = path.join(dir, "dist", "core", "index.js");
		const root = packageRootOf(distFile);
		if (root && fsExists(distFile)) return root;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/** 定位 super-plumber 包根（dist 必须已构建）；优先当前分发树，最后才回退全局。 */
function resolvePackageRoot() {
	// 1) 当前 integrations/<channel>/scripts、.pi/.../scripts 或源码脚本所在包根。
	//    源码仓库不会把自己安装进 node_modules；若直接回退全局，测试/开发会误跑另一棵树。
	const bundledRoot = bundledPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
	if (bundledRoot) return bundledRoot;
	// 2) 项目本地安装 / 仓库自引用：沿 node_modules 解析规则定位公开桶入口
	try {
		const require = createRequire(import.meta.url);
		const coreJs = require.resolve(`${PKG_NAME}/core`);
		const root = packageRootOf(coreJs);
		if (root && fsExists(path.join(root, "dist", "core", "index.js"))) return root;
	} catch {
		// 未本地安装 → 尝试全局
	}
	// 3) 全局安装回退
	try {
		const globalRoot = execSync("npm root -g", { stdio: ["pipe", "pipe", "pipe"] })
			.toString()
			.trim();
		const root = path.join(globalRoot, PKG_NAME);
		if (fsExists(path.join(root, "dist", "core", "index.js"))) return root;
	} catch {
		// npm 不可用
	}
	return null;
}

/** 解析脚本级目标图旗标；允许放在子命令前后，避免 shell/调用方改变参数顺序。 */
function parseGraphArgs(args) {
	const rest = [];
	let graph;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--graph" || arg.startsWith("--graph=")) {
			const value = arg === "--graph" ? args[++i] : arg.slice("--graph=".length);
			if (!value || value.startsWith("--")) {
				console.error("❌ --graph 需要图名");
				process.exit(1);
			}
			if (graph !== undefined) {
				console.error("❌ --graph 只能指定一次");
				process.exit(1);
			}
			graph = value;
			continue;
		}
		rest.push(arg);
	}
	return { args: rest, graph };
}

/** CLI 透传：spawn dist/cli/index.js，stdio/退出码原样透传（语义 ≡ CLI 的机制保证）。 */
function runCli(root, cliArgs, graph) {
	const cliEntry = path.join(root, "dist", "cli", "index.js");
	const targetArgs = graph === undefined ? cliArgs : [...cliArgs, "--graph", graph];
	const res = spawnSync(process.execPath, [cliEntry, ...targetArgs], { stdio: "inherit" });
	if (res.error) {
		console.error(`❌ 无法启动 CLI（${cliEntry}）: ${res.error.message}`);
		process.exit(1);
	}
	process.exit(res.status ?? 1);
}

/** 核心公开 API 加载（与 CLI/MCP 同源）；定位失败给出安装指引。 */
async function loadCore() {
	const root = resolvePackageRoot();
	if (root) {
		try {
			return await import(pathToFileURL(path.join(root, "dist", "core", "index.js")).href);
		} catch {
			// 落到下方统一报错
		}
	}
	console.error(
		`❌ 无法定位 ${PKG_NAME} 核心（需已构建的 dist/）。请安装: npm install -g ${PKG_NAME}`,
	);
	process.exit(1);
}

// ---------------------------------------------------------------------------
// 子命令实现
// ---------------------------------------------------------------------------

function subcommandClaim(root, args, graph) {
	const [id, claimBy] = args;
	if (!id || !claimBy) {
		console.error("Usage: node sp.mjs claim <node_id> <claim_by> [--graph <name>]");
		process.exit(1);
	}
	// 原子认领 = update-status running + claim-by（CLI 同一入口，状态机与审计单源）
	runCli(root, ["update-status", "-i", id, "-s", "running", "--claim-by", claimBy], graph);
}

function subcommandUpdateStatus(root, args, graph) {
	const [id, status, flag] = args;
	if (!id || !status) {
		console.error(
			"Usage: node sp.mjs update-status <node_id> <pending|ready|running|passed|failed|blocked|cancelled> [--force] [--graph <name>]",
		);
		process.exit(1);
	}
	const cliArgs = ["update-status", "-i", id, "-s", status];
	if (flag === "--force") cliArgs.push("--force");
	runCli(root, cliArgs, graph);
}

function subcommandGetNode(root, args, graph) {
	const [id] = args;
	if (!id) {
		console.error("Usage: node sp.mjs get-node <node_id> [--graph <name>]");
		process.exit(1);
	}
	// 脚本通道面向 agent 消费：默认取 CLI 的 --json 稳定输出面（≡ CLI get-node --json）
	runCli(root, ["get-node", "-i", id, "--json"], graph);
}

async function subcommandCheckpoint(args, graph) {
	const [nodeId, cpId, status] = args;
	if (!nodeId || !cpId || !status) {
		console.error(
			"Usage: node sp.mjs checkpoint <node_id> <checkpoint_id> <pending|running|passed|failed|skipped> [--graph <name>]",
		);
		process.exit(1);
	}
	// 前置校验：非法 status 直接友好报错（核心层也会拦截，这里给 agent 更清晰的提示）
	const CP_STATUSES = ["pending", "running", "passed", "failed", "skipped"];
	if (!CP_STATUSES.includes(status)) {
		console.error(`❌ 非法 checkpoint 状态: ${status}。允许的值: ${CP_STATUSES.join(", ")}`);
		process.exit(1);
	}
	const core = await loadCore();
	const { updateCheckpoint } = core;
	try {
		const target = resolveGraphTarget(core, graph);
		const node = updateCheckpoint(target, nodeId, cpId, status);
		const cp = node.checkpoints?.find((c) => c.id === cpId);
		console.log(`✅ ${nodeId} / ${cpId}: ${cp?.status}`);
	} catch (err) {
		console.error(`❌ ${err.message}`);
		process.exit(1);
	}
}

async function subcommandReport(args, graph) {
	const [nodeId, summary, artifactsCsv, blockersCsv, notes] = args;
	if (!nodeId || !summary) {
		console.error(
			"Usage: node sp.mjs report <node_id> <summary> [artifacts.csv] [blockers.csv] [notes] [--graph <name>]",
		);
		process.exit(1);
	}
	const report = {
		summary,
		...(artifactsCsv ? { artifacts: artifactsCsv.split(",").map((s) => s.trim()) } : {}),
		...(blockersCsv ? { blockers: blockersCsv.split(",").map((s) => s.trim()) } : {}),
		...(notes ? { notes } : {}),
	};
	const core = await loadCore();
	const { updateExecutionReport } = core;
	try {
		const target = resolveGraphTarget(core, graph);
		const node = updateExecutionReport(target, nodeId, report);
		console.log(
			`✅ ${nodeId}: execution_report saved (${node.execution_report?.artifacts?.length ?? 0} artifacts)`,
		);
	} catch (err) {
		console.error(`❌ ${err.message}`);
		process.exit(1);
	}
}

// IL-017：traverse 语义 ≡ MCP graph_traverse——max_depth 缺省 3、上限 50（≡ zod .max(50)），
// max_nodes 固定 200（≡ MCP 缺省），深度/节点数两类截断分开记账、如实上报。
// 注：CLI 目前无 traverse 子命令，故走核心 buildGraphIndex 单点调用；下方 dfs 与
// src/mcp/server.ts graph_traverse 逐行同构，改动必须与 MCP 通道同步。
const MAX_DEPTH_LIMIT = 50; // ≡ MCP graph_traverse max_depth zod 上限
const MAX_NODES_LIMIT = 200; // ≡ MCP graph_traverse max_nodes 缺省

async function subcommandTraverse(args, graph) {
	const [nodeId, directionArg, depthArg] = args;
	if (!nodeId) {
		console.error(
			"Usage: node sp.mjs traverse <node_id> [downstream|upstream|both] [max_depth] [--graph <name>]",
		);
		process.exit(1);
	}
	const direction = directionArg ?? "downstream";
	if (!["downstream", "upstream", "both"].includes(direction)) {
		console.error(`❌ 无效方向: ${direction}（可选 downstream|upstream|both）`);
		process.exit(1);
	}
	const maxDepth = Number.parseInt(depthArg ?? "3", 10);
	if (Number.isNaN(maxDepth) || maxDepth < 1) {
		console.error(
			`❌ 无效 max_depth: ${depthArg}（需正整数，上限 ${MAX_DEPTH_LIMIT}）`,
		);
		process.exit(1);
	}
	const effectiveDepth = Math.min(maxDepth, MAX_DEPTH_LIMIT);

	try {
		const core = await loadCore();
		const index = core.buildGraphIndex(resolveGraphTarget(core, graph));
		// 起点不存在时明确报错（≡ MCP：曾静默返回 [node_id] 误导调用方以为节点存在）
		if (!index.adjacency.has(nodeId)) {
			throw new Error(`Node ${nodeId} not found`);
		}
		const visited = new Set();
		const nodes = [];
		let truncatedByDepth = false;
		let truncatedByNodes = false;
		// 与 src/mcp/server.ts graph_traverse 的 dfs 逐行同构（先查 visited，再深度、再节点数）
		function dfs(cur, depth) {
			if (visited.has(cur)) return;
			if (depth > effectiveDepth) {
				truncatedByDepth = true;
				return;
			}
			if (nodes.length >= MAX_NODES_LIMIT) {
				truncatedByNodes = true;
				return;
			}
			visited.add(cur);
			nodes.push(cur);
			if (direction === "downstream" || direction === "both") {
				for (const n of index.adjacency.get(cur) ?? []) dfs(n, depth + 1);
			}
			if (direction === "upstream" || direction === "both") {
				for (const n of index.reverseAdj.get(cur) ?? []) dfs(n, depth + 1);
			}
		}
		dfs(nodeId, 0);
		console.log(
			JSON.stringify({
				nodes,
				truncated: truncatedByDepth || truncatedByNodes,
				truncated_by_depth: truncatedByDepth,
				truncated_by_nodes: truncatedByNodes,
			}),
		);
	} catch (err) {
		console.error(`❌ ${err.message}`);
		process.exit(1);
	}
}

/** check-design：转发同目录 sp-check-design.mjs，stdio/退出码透传（doctor 语义单点在该文件）。 */
function subcommandCheckDesign(args, graph) {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const doctor = path.join(here, "sp-check-design.mjs");
	if (!fsExists(doctor)) {
		console.error(`❌ 未找到设计体检脚本 sp-check-design.mjs（应与本文件同目录）: ${doctor}`);
		process.exit(1);
	}
	const targetArgs = graph === undefined ? args : [...args, "--graph", graph];
	const res = spawnSync(process.execPath, [doctor, ...targetArgs], { stdio: "inherit" });
	if (res.error) {
		console.error(`❌ 无法启动 sp-check-design.mjs: ${res.error.message}`);
		process.exit(1);
	}
	process.exit(res.status ?? 1);
}

// ---------------------------------------------------------------------------
// 入口分发
// ---------------------------------------------------------------------------

async function main() {
	const parsed = parseGraphArgs(process.argv.slice(2));
	const [subcommand, ...rest] = parsed.args;
	const graph = parsed.graph;

	switch (subcommand) {
		case "claim":
			subcommandClaim(resolvePackageRootOrExit(), rest, graph);
			break;
		case "update-status":
		case "us":
			subcommandUpdateStatus(resolvePackageRootOrExit(), rest, graph);
			break;
		case "get-node":
		case "gn":
			subcommandGetNode(resolvePackageRootOrExit(), rest, graph);
			break;
		case "checkpoint":
			await subcommandCheckpoint(rest, graph);
			break;
		case "report":
			await subcommandReport(rest, graph);
			break;
		case "traverse":
			await subcommandTraverse(rest, graph);
			break;
		case "check-design":
		case "doctor":
			subcommandCheckDesign(rest, graph);
			break;
		case "help":
		case "--help":
		case "-h":
			console.log(USAGE);
			process.exit(0);
			break;
		case undefined:
			console.error(USAGE);
			process.exit(1);
			break;
		default:
			console.error(`❌ 未知子命令: ${subcommand}`);
			console.error(USAGE);
			process.exit(1);
	}
}

export { bundledPackageRoot, loadCore, resolvePackageRoot };

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	await main();
}

function resolvePackageRootOrExit() {
	const root = resolvePackageRoot();
	if (!root) {
		console.error(
			`❌ 无法定位 ${PKG_NAME}（需已构建的 dist/）。请安装: npm install -g ${PKG_NAME}`,
		);
		process.exit(1);
	}
	return root;
}

/** 将脚本目标统一收敛到 core 的五级图目录解析，供非 CLI 子命令使用。 */
function resolveGraphTarget(core, graph) {
	return core.resolveGraphDir(process.cwd(), {
		name: graph,
		env: process.env.SUPER_PLUMBER_GRAPH,
	}).dir;
}
