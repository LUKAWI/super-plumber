import * as chokidar from "chokidar";
import * as path from "node:path";

export type FileChangeEvent = {
  type: "add" | "change" | "unlink";
  file: string;
  timestamp: number;
};

export function createWatcher(rootDir: string, onChange: (event: FileChangeEvent) => void) {
  const watchDir = path.join(rootDir, ".graph");
  const watcher = chokidar.watch(watchDir, {
    ignored: /index\//,
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
