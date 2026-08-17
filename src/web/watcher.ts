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
    // 排除内部/派生目录与软删除历史：
    // - index/：派生缓存（graph rebuild 产物，写入会引发自触发风暴）
    // - .locks/：每次状态流转的锁文件增删（含目录自身的 addDir 事件，
    //   路径无尾斜杠，故模式需同时匹配目录本身）
    // - snapshots/：graph snapshot 会整目录复制
    // - .deleted.yaml 的 add 事件会与节点 unlink 重复推送（removed=true 发两次）
    ignored: [
      /(^|\/)index(\/|$)/,
      /(^|\/)\.locks(\/|$)/,
      /(^|\/)snapshots(\/|$)/,
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
