#!/usr/bin/env bash
# 读取单个节点的全部内容
# Usage: sp-get-node.sh <node_id>
set -euo pipefail
NODE_FILE=".graph/nodes/$1.yaml"
if [ ! -f "$NODE_FILE" ]; then
  echo "❌ 节点 $1 不存在"
  exit 1
fi
cat "$NODE_FILE"
