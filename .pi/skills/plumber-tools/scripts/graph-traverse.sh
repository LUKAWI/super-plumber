#!/usr/bin/env bash
# 从指定节点遍历相邻节点
# Usage: graph-traverse.sh <node_id> [direction] [max_depth]
# direction: downstream (默认) | upstream | both
set -euo pipefail
START_NODE="$1"
DIRECTION="${2:-downstream}"
MAX_DEPTH="${3:-3}"

# 构建邻接表
declare -A DOWNSTREAM
declare -A UPSTREAM

for EDGE_FILE in .graph/edges/*.yaml; do
  [ -f "$EDGE_FILE" ] || continue
  SOURCE=$(grep -oP '(?<=^source: ).*' "$EDGE_FILE")
  TARGET=$(grep -oP '(?<=^target: ).*' "$EDGE_FILE")
  if [ -n "$SOURCE" ] && [ -n "$TARGET" ]; then
    DOWNSTREAM["$SOURCE"]="${DOWNSTREAM["$SOURCE"]:-} $TARGET"
    UPSTREAM["$TARGET"]="${UPSTREAM["$TARGET"]:-} $SOURCE"
  fi
done

# DFS 遍历
declare -A VISITED
RESULT=()

function dfs() {
  local NODE="$1"
  local DEPTH="$2"
  if [ "$DEPTH" -gt "$MAX_DEPTH" ] || [ "${VISITED[$NODE]:-0}" -eq 1 ]; then
    return
  fi
  VISITED["$NODE"]=1
  RESULT+=("$NODE")

  if [ "$DIRECTION" = "downstream" ] || [ "$DIRECTION" = "both" ]; then
    for NEXT in ${DOWNSTREAM["$NODE"]:-}; do
      dfs "$NEXT" $((DEPTH + 1))
    done
  fi
  if [ "$DIRECTION" = "upstream" ] || [ "$DIRECTION" = "both" ]; then
    for NEXT in ${UPSTREAM["$NODE"]:-}; do
      dfs "$NEXT" $((DEPTH + 1))
    done
  fi
}

dfs "$START_NODE" 0

echo "遍历结果 (${#RESULT[@]} 节点):"
for N in "${RESULT[@]}"; do
  STATUS=""
  NF=".graph/nodes/$N.yaml"
  [ -f "$NF" ] && STATUS=$(grep -oP '(?<=^status: ).*' "$NF" 2>/dev/null || true)
  echo "  $N${STATUS:+ ($STATUS)}"
done
