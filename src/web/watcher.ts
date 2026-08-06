import * as chokidar from "chokidar";
import * as path from "node:path";

export type FileChangeEvent = {
  type: "add" | "change" | "unlink";
  file: string;
  timestamp: number;
};

export function createWatcher(
  rootDir: string,
  onChange: (event: FileChangeEvent) => void,
) {
  const watchDir = path.join(rootDir, ".graph");
  const watcher = chokidar.watch(watchDir, {
    // 排除 index/ 与软删除历史文件：.deleted.yaml 的 add 事件会与节点 unlink 重复推送
    // 相同的 removed=true（曾导致删除节点触发 2 次 node:updated）
    ignored: [/index\//, /\.deleted[^/]*\.yaml$/],
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
