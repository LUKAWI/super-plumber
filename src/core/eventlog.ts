// src/core/eventlog.ts
// FIX-C1（评审 C 级·无事件日志）：append-only 事件日志。
// 每次结构性变更（创建/删除/状态流转/裁决/快照/回滚/force 越权/attempts 重置）
// 追加一行 JSON 到 .graph/events.jsonl，长程任务流可追溯"何时、何人、改了什么"。
// 设计约束：
//   - 追加-only，永不改写历史行；撕裂行（并发极端情形）读取时跳过不致命。
//   - 写入走独立锁 id "__events__"（与节点/边锁不同文件，无锁序倒置死锁风险）。
//   - 审计完整性优先：事件写失败向前抛出（不做静默 best-effort），
//     但事件写在状态写入之后——状态是真相源，事件是它的影子。
import * as fs from "node:fs";
import * as path from "node:path";
import { withLockSync } from "./lock.js";
import { GRAPH_DIR } from "./types.js";
import { toGraphDir } from "./graph-dir.js";

export interface GraphEvent {
  ts: string; // ISO 8601
  actor: string; // "cli" | "mcp" | claimBy 名 | "unknown"
  kind: GraphEventKind;
  node?: string;
  edge?: string;
  from?: string;
  to?: string;
  detail?: string;
}

export type GraphEventKind =
  | "node_created"
  | "node_deleted"
  | "edge_created"
  | "edge_deleted"
  | "node_status"
  | "force_override"
  | "checkpoint_updated"
  | "execution_report"
  | "verdict"
  | "node_content_updated"
  | "attempts_reset"
  | "node_reclaimed"
  | "snapshot_created"
  | "rollback"
  // v0.5 领域事件（ADR 生命周期）
  | "adr_created"
  | "adr_accepted"
  | "adr_superseded"
  // DEC-1（g080-approve-core）：设计审核凭据写入（payload：by/status 见 detail；
  // review 仅记录、零门禁，不伴随任何状态机变更）
  | "design_approved";

const EVENTS_LOCK = "__events__";
const EVENTS_FILE = "events.jsonl";

export function eventsFilePath(rootDir: string): string {
  return path.join(toGraphDir(rootDir), EVENTS_FILE);
}

export type EventInput = Omit<GraphEvent, "ts"> & { ts?: string };

/** 追加一条事件（锁内单行 append，进程间串行化防撕裂） */
export function appendEvent(rootDir: string, evt: EventInput): void {
  const record: GraphEvent = { ts: evt.ts ?? new Date().toISOString(), ...evt };
  const line = JSON.stringify(record) + "\n";
  withLockSync(rootDir, EVENTS_LOCK, () => {
    fs.mkdirSync(toGraphDir(rootDir), { recursive: true });
    fs.appendFileSync(eventsFilePath(rootDir), line, "utf-8");
  });
}

export interface EventFilter {
  node?: string;
  kind?: string;
}

/** 读取事件（可选过滤），按写入顺序返回；撕裂行跳过 */
export function readEvents(rootDir: string, filter: EventFilter = {}): GraphEvent[] {
  const file = eventsFilePath(rootDir);
  if (!fs.existsSync(file)) return [];
  const events: GraphEvent[] = [];
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      events.push(JSON.parse(line) as GraphEvent);
    } catch {
      /* 撕裂行：跳过，不让单行损坏毒化整个日志读取 */
    }
  }
  return events.filter(
    (e) =>
      (filter.node === undefined || e.node === filter.node) &&
      (filter.kind === undefined || e.kind === filter.kind),
  );
}
