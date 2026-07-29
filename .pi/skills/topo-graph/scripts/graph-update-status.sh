#!/usr/bin/env bash
# 更新节点状态（含状态机校验）
# Usage: graph-update-status.sh <node_id> <new_status>
set -euo pipefail
NODE_FILE=".graph/nodes/$1.yaml"
if [ ! -f "$NODE_FILE" ]; then
  echo "❌ 节点 $1 不存在"
  exit 1
fi

NODE=$(cat "$NODE_FILE")
CURRENT_STATUS=$(echo "$NODE" | grep -oP '(?<=^status: ).*')
NEW_STATUS="$2"

# 基本状态机校验（简化版）
VALID=0
case "$CURRENT_STATUS" in
  pending)   [[ "$NEW_STATUS" =~ ^(ready|cancelled)$ ]] && VALID=1 ;;
  ready)     [[ "$NEW_STATUS" =~ ^(running|cancelled)$ ]] && VALID=1 ;;
  running)   [[ "$NEW_STATUS" =~ ^(passed|failed|cancelled)$ ]] && VALID=1 ;;
  passed)    [[ "$NEW_STATUS" =~ ^(blocked|cancelled)$ ]] && VALID=1 ;;
  failed)    [[ "$NEW_STATUS" =~ ^(pending|cancelled)$ ]] && VALID=1 ;;
  blocked)   [[ "$NEW_STATUS" =~ ^(ready|failed|cancelled)$ ]] && VALID=1 ;;
  cancelled) VALID=0 ;;
esac

if [ "$VALID" -eq 0 ]; then
  echo "❌ 非法状态转换: $CURRENT_STATUS → $NEW_STATUS"
  exit 1
fi

# 更新 status 和 updated_at
sed -i "s/^status: .*/status: $NEW_STATUS/" "$NODE_FILE"
sed -i "s/^updated_at: .*/updated_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)/" "$NODE_FILE"

# failed → pending 时 attempts+1
if [ "$CURRENT_STATUS" = "failed" ] && [ "$NEW_STATUS" = "pending" ]; then
  CURRENT_ATTEMPTS=$(echo "$NODE" | grep -oP '(?<=^attempts: ).*')
  NEW_ATTEMPTS=$((CURRENT_ATTEMPTS + 1))
  sed -i "s/^attempts: .*/attempts: $NEW_ATTEMPTS/" "$NODE_FILE"
fi

echo "✅ $1: $CURRENT_STATUS → $NEW_STATUS"
