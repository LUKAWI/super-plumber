import * as chokidar from "chokidar";
import * as path from "node:path";
import { GRAPH_DIR } from "../core/types.js";

export type FileChangeEvent = {
  type: "add" | "change" | "unlink";
  file: string;
  timestamp: number;
};

/**
 * v0.5.2 多图并行渲染：监听整个 .graph/（全部图目录 + 工作区级文件），
 * 事件按路径前缀分类到所属图的逻辑在 server.ts 的 routeGraphEvent。
 * wsRoot 必须是工作区根（.graph/ 的父目录）；事件 file 为相对 wsRoot 的路径。
 */
export function createWatcher(
  wsRoot: string,
  onChange: (event: FileChangeEvent) => void,
) {
  const watchDir = path.join(wsRoot, GRAPH_DIR);
  const watcher = chokidar.watch(watchDir, {
    // 排除内部/派生目录与软删除历史（模式匹配任意层级，即各图目录下的同名子目录）：
    // - index/：派生缓存（graph rebuild 产物，写入会引发自触发风暴）
    // - .locks/：每次状态流转的锁文件增删（含目录自身的 addDir 事件，
    //   路径无尾斜杠，故模式需同时匹配目录本身）
    // - snapshots/：graph snapshot 会整目录复制
    // - .trash/：v0.5.2 图软删除的回收站（整目录 rename 进出，不入事件流）
    // - events.jsonl：事件日志每次写操作都追加（FIX-C1），不忽略会持续触发全量推送
    // - .deleted.yaml 的 add 事件会与节点 unlink 重复推送（removed=true 发两次）
    ignored: [
      /(^|\/)index(\/|$)/,
      /(^|\/)\.locks(\/|$)/,
      /(^|\/)snapshots(\/|$)/,
      /(^|\/)\.trash(\/|$)/,
      /(^|\/)events\.jsonl$/,
      /\.deleted[^/]*\.yaml$/,
    ],
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on("all", (event, filePath) => {
    try {
      onChange({
        type: event as FileChangeEvent["type"],
        file: path.relative(wsRoot, filePath),
        timestamp: Date.now(),
      });
    } catch (err) {
      // 单个事件的消费异常不能升级为未处理异常击穿 serve 进程；后续事件仍继续。
      console.error("[serve] watcher event handling failed:", err);
    }
  });
  watcher.on("error", (err) => {
    // watcher 错误不应成为未处理的 EventEmitter error 进而终止 serve 进程。
    console.error("[serve] watcher failed:", err);
  });

  return watcher;
}
