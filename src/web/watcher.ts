import * as chokidar from "chokidar";
import * as path from "node:path";
import { toGraphDir } from "../core/graph-dir.js";

export type FileChangeEvent = {
  type: "add" | "change" | "unlink";
  file: string;
  timestamp: number;
};

export function createWatcher(
  rootDir: string,
  onChange: (event: FileChangeEvent) => void,
) {
  const watchDir = toGraphDir(rootDir); // v0.5.2：监听图目录（多图重构在 webui_multi 节点）
  const watcher = chokidar.watch(watchDir, {
    // 排除内部/派生目录与软删除历史：
    // - index/：派生缓存（graph rebuild 产物，写入会引发自触发风暴）
    // - .locks/：每次状态流转的锁文件增删（含目录自身的 addDir 事件，
    //   路径无尾斜杠，故模式需同时匹配目录本身）
    // - snapshots/：graph snapshot 会整目录复制
    // - events.jsonl：事件日志每次写操作都追加（FIX-C1），不忽略会持续触发全量推送
    // - .deleted.yaml 的 add 事件会与节点 unlink 重复推送（removed=true 发两次）
    ignored: [
      /(^|\/)index(\/|$)/,
      /(^|\/)\.locks(\/|$)/,
      /(^|\/)snapshots(\/|$)/,
      /(^|\/)events\.jsonl$/,
      /\.deleted[^/]*\.yaml$/,
    ],
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on("all", (event, filePath) => {
    onChange({
      type: event as FileChangeEvent["type"],
      file: path.relative(rootDir, filePath),
      timestamp: Date.now(),
    });
  });

  return watcher;
}
