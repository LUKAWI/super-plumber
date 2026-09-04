// src/core/errors.ts — arch-c1（C1）：核心错误机器可读 code 单源
// 目的：CLI/MCP 双渠道此前靠 message 字符串嗅探分类错误（isNodeNotFound 三副本、
// ENOENT 提示六份），文案一改分类就静默失效。本模块给核心错误落最小集六枚
// 机器可读 code，双渠道统一消费 code 判定，message 只面向人类。
//
// 决策来源：2026-09-02 架构评审 C1 + grilling 拍板（最小集六枚，不做全量错误taxonomy）。

export const ErrorCode = {
  /** 节点不存在（getNode/deleteNode/ADR 接替者校验等） */
  NodeNotFound: "NODE_NOT_FOUND",
  /** 工作区未初始化（graph.yaml 缺失——approve/status/create-node 等的"请先 init"一族） */
  WorkspaceNotInitialized: "WORKSPACE_NOT_INITIALIZED",
  /** 非法状态转换（工作流七态机 / ADR 三态机 / checkpoint 状态机） */
  InvalidTransition: "INVALID_TRANSITION",
  /** 门禁未满足（ready 前置门禁 / passed 硬门禁） */
  GateNotSatisfied: "GATE_NOT_SATISFIED",
  /** 重试预算耗尽（failed/cancelled → pending 受 max_attempts 拦截） */
  AttemptsExhausted: "ATTEMPTS_EXHAUSTED",
  /** 校验失败（schema 写前校验/读侧校验拒绝落盘或解析） */
  ValidationFailed: "VALIDATION_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 带机器可读 code 的核心错误。message 保持人类可读原文案（既有测试/双渠道零破坏）。 */
export class GraphError extends Error {
  readonly code: ErrorCode;
  /** NODE_NOT_FOUND 时缺失实体的 id（CLI 单源渲染 `节点不存在: <id>` 用） */
  readonly entityId?: string;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { entityId?: string } = {},
  ) {
    super(message);
    this.name = "GraphError";
    this.code = code;
    if (opts.entityId !== undefined) this.entityId = opts.entityId;
  }
}

/** NODE_NOT_FOUND 构造器（message 与拆码前的 `Node <id> not found` 逐字一致） */
export function nodeNotFound(id: string, message?: string): GraphError {
  return new GraphError(ErrorCode.NodeNotFound, message ?? `Node ${id} not found`, {
    entityId: id,
  });
}

/** WORKSPACE_NOT_INITIALIZED 构造器（graph.yaml 缺失的统一提示，六份归一后的单源文案） */
export function workspaceNotInitialized(dir: string): GraphError {
  return new GraphError(
    ErrorCode.WorkspaceNotInitialized,
    `未找到图（${dir} 无 graph.yaml），请先运行 graph init <内容名>`,
  );
}

/**
 * 节点不存在判定（单源）。只认结构化 code——不做 message 嗅探：
 * "Edge x not found"/"Snapshot x not found" 与节点无关，message 兜底会把它们误分类
 * （get-node.ts 旧副本注释里明确警告过的坑，code 落地后彻底移除该通道）。
 */
export function isNodeNotFound(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === ErrorCode.NodeNotFound;
}

/** 工作区未初始化判定（单源）：graph.yaml 缺失一族错误的 code 通道 */
export function isWorkspaceNotInitialized(err: unknown): boolean {
  return (
    (err as { code?: string } | null)?.code === ErrorCode.WorkspaceNotInitialized
  );
}
