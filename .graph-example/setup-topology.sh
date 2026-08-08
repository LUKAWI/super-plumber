#!/usr/bin/env bash
# 一键创建拓扑图管理工具的完整拓扑（含详细任务描述）
set -euo pipefail
CLI="node dist/cli/index.js"

# ═══════════════════════════════════════════
# L1 主干节点
# ═══════════════════════════════════════════

$CLI create-node --id l1_data_model  --type task --label "数据模型设计" --level 1 \
  --plan-desc "设计拓扑图的核心数据模型：定义Node/Edge/Graph三个核心Schema接口，以及NodeStatus/NodeType/EdgeType枚举" \
  --dod "完成NodeSchema/EdgeSchema/GraphSchema接口定义" \
  --dod "完成状态机和边类型枚举" \
  --dod "核心类型零外部依赖，编译通过"

$CLI create-node --id l1_core_engine --type task --label "核心引擎(状态机+拓扑排序)" --level 1 \
  --plan-desc "实现节点状态机转换规则、拓扑排序算法(Kahn)、循环检测(DFS)，以及节点/边的CRUD操作" \
  --dod "状态机7状态13种转换全部校验" \
  --dod "拓扑排序和循环检测算法正确" \
  --dod "所有核心测试通过"

$CLI create-node --id l1_cli         --type task --label "CLI工具开发" --level 1 \
  --plan-desc "开发graph CLI工具的全部命令：init/create-node/add-edge/update-status/delete-node/status/validate/rebuild/export/serve" \
  --dod "11个CLI命令全部可用" \
  --dod "所有命令有错误处理和友好提示" \
  --dod "CLI e2e测试通过"

$CLI create-node --id l1_mcp         --type task --label "MCP Server开发" --level 1 \
  --plan-desc "开发STDIO传输的MCP服务器，注册graph_*系列工具供agent调用" \
  --dod "7个MCP工具注册可用" \
  --dod "STDIO传输协议正确" \
  --dod "错误处理完整，非法操作返回isError"

$CLI create-node --id l1_visual      --type task --label "可视化(Web UI+Mermaid)" --level 1 \
  --plan-desc "开发Web前端可视化界面(基于已有的Svelte+D3.js)和Mermaid导出功能" \
  --dod "Web UI显示力导向拓扑图" \
  --dod "WebSocket实时同步后端变更" \
  --dod "Mermaid导出包含节点状态着色"

# ═══════════════════════════════════════════
# L2 子节点
# ═══════════════════════════════════════════

# 数据模型内部
$CLI create-node --id l2_schema        --type task --label "节点/边 Schema 定义" --level 2 \
  --plan-desc "在types.ts中定义NodeSchema/EdgeSchema/GraphSchema等核心类型" \
  --dod "所有接口和枚举定义完整" \
  --dod "类型编译通过"

$CLI create-node --id l2_yaml          --type task --label "YAML序列化/反序列化" --level 2 \
  --plan-desc "基于js-yaml实现.graph目录的YAML文件读写" \
  --dod "readGraph/writeGraph正确" \
  --dod "readNode/writeNode正确" \
  --dod "readEdge/writeEdge正确"

# 核心引擎内部
$CLI create-node --id l2_state_machine --type task --label "状态机实现" --level 2 \
  --plan-desc "实现7状态13种转换的校验逻辑和checkpoint聚合" \
  --dod "canTransition/transition/getAllowedTransitions正确" \
  --dod "checkpoint聚合状态正确"

$CLI create-node --id l2_topo_sort     --type task --label "拓扑排序+循环检测" --level 2 \
  --plan-desc "Kahn拓扑排序和DFS循环检测，忽略运行时边(fallback/iterates)" \
  --dod "拓扑排序正确处理线性/扇出依赖" \
  --dod "循环检测发现环并忽略fallback边"

$CLI create-node --id l2_node_crud     --type task --label "节点CRUD操作" --level 2 \
  --plan-desc "实现createNode/getNode/updateNodeStatus/listNodes/updateNodeContent" \
  --dod "所有节点操作函数正确" \
  --dod "状态转换调用状态机校验"

$CLI create-node --id l2_edge_crud     --type task --label "边CRUD操作" --level 2 \
  --plan-desc "实现createEdge/getEdge/listEdges，支持7种边类型和合约" \
  --dod "边创建/读取/列表正确" \
  --dod "边合约(contract)可选支持"

# CLI内部
$CLI create-node --id l2_cli_init      --type task --label "graph init/delete" --level 2 \
  --plan-desc "实现graph init初始化目录和graph delete-node软删除" \
  --dod "init创建完整.graph目录" \
  --dod "delete-node保留.deleted.yaml历史"

$CLI create-node --id l2_cli_crud      --type task --label "create-node/add-edge/update" --level 2 \
  --plan-desc "实现create-node/add-edge/update-status/update-node命令" \
  --dod "所有命令参数解析正确" \
  --dod "错误信息友好可读"

$CLI create-node --id l2_cli_status    --type task --label "status/validate/rebuild" --level 2 \
  --plan-desc "实现status状态概览、validate结构校验、rebuild重建索引" \
  --dod "status显示状态分布" \
  --dod "validate检测引用完整性" \
  --dod "rebuild重建.graph/index/"

$CLI create-node --id l2_cli_export    --type task --label "export --mermaid导出" --level 2 \
  --plan-desc "实现graph export --mermaid导出为Mermaid流程图" \
  --dod "生成graph TD格式" \
  --dod "节点按status着色"

# MCP内部
$CLI create-node --id l2_mcp_server    --type task --label "MCP STDIO Server" --level 2 \
  --plan-desc "搭建基于@modelcontextprotocol/sdk的STDIO传输MCP服务器" \
  --dod "ListToolsRequestSchema响应正确" \
  --dod "CallToolRequestSchema路由正确"

$CLI create-node --id l2_mcp_tools     --type task --label "graph_* 工具注册" --level 2 \
  --plan-desc "注册7个graph工具：get/create/update-status/delete-node/get-graph/traverse/search" \
  --dod "所有工具inputSchema完整" \
  --dod "错误处理返回isError"

# 可视化内部
$CLI create-node --id l2_web_backend   --type task --label "Web后端(HTTP+WebSocket)" --level 2 \
  --plan-desc "实现graph serve命令，HTTP静态服务+WebSocket热同步+文件监听" \
  --dod "HTTP服务/api/graph返回图索引" \
  --dod "WebSocket文件变更推送" \
  --dod "端口8934，非标准端口"

$CLI create-node --id l2_web_frontend  --type task --label "Svelte+D3.js前端" --level 2 \
  --plan-desc "实现Svelte 5 + D3.js力导向图可视化，含loading/empty/node-detail/动画" \
  --dod "力导向图渲染节点和边" \
  --dod "节点hover/click交互" \
  --dod "详情面板slide-in动画" \
  --dod "prefers-reduced-motion支持"

$CLI create-node --id l2_mermaid       --type task --label "Mermaid导出" --level 2 \
  --plan-desc "实现graph export的Mermaid格式生成" \
  --dod "所有节点和边正确渲染" \
  --dod "状态着色正确"

# ═══════════════════════════════════════════
# 边
# ═══════════════════════════════════════════

# 数据模型内部
$CLI add-edge --id e001 --source l2_schema --target l2_yaml --type depends_on

# 主干依赖
$CLI add-edge --id e002 --source l1_data_model  --target l1_core_engine --type depends_on
$CLI add-edge --id e003 --source l1_data_model  --target l1_cli         --type depends_on
$CLI add-edge --id e004 --source l1_core_engine --target l1_cli         --type depends_on
$CLI add-edge --id e005 --source l1_core_engine --target l1_mcp         --type depends_on
$CLI add-edge --id e006 --source l1_core_engine --target l1_visual      --type depends_on
$CLI add-edge --id e007 --source l1_cli         --target l1_mcp         --type depends_on

# L1 → L2
$CLI add-edge --id e008 --source l1_data_model  --target l2_schema        --type depends_on
$CLI add-edge --id e009 --source l2_schema       --target l2_yaml          --type depends_on
$CLI add-edge --id e010 --source l1_core_engine  --target l2_state_machine --type depends_on
$CLI add-edge --id e011 --source l2_state_machine --target l2_node_crud    --type depends_on
$CLI add-edge --id e012 --source l2_yaml          --target l2_node_crud    --type depends_on
$CLI add-edge --id e013 --source l2_node_crud     --target l2_edge_crud    --type depends_on
$CLI add-edge --id e014 --source l2_state_machine --target l2_topo_sort    --type depends_on
$CLI add-edge --id e015 --source l2_edge_crud     --target l2_topo_sort    --type depends_on

# CLI 内部
$CLI add-edge --id e016 --source l2_node_crud   --target l2_cli_init   --type depends_on
$CLI add-edge --id e017 --source l2_node_crud   --target l2_cli_crud   --type depends_on
$CLI add-edge --id e018 --source l2_edge_crud   --target l2_cli_crud   --type depends_on
$CLI add-edge --id e019 --source l2_topo_sort   --target l2_cli_status --type depends_on
$CLI add-edge --id e020 --source l2_node_crud   --target l2_cli_status --type depends_on
$CLI add-edge --id e021 --source l2_node_crud   --target l2_cli_export --type depends_on
$CLI add-edge --id e022 --source l2_edge_crud   --target l2_cli_export --type depends_on

# MCP 内部
$CLI add-edge --id e023 --source l2_node_crud   --target l2_mcp_server --type depends_on
$CLI add-edge --id e024 --source l2_edge_crud   --target l2_mcp_server --type depends_on
$CLI add-edge --id e025 --source l2_mcp_server  --target l2_mcp_tools  --type depends_on
$CLI add-edge --id e026 --source l2_topo_sort   --target l2_mcp_tools  --type depends_on

# 可视化内部
$CLI add-edge --id e027 --source l2_topo_sort    --target l2_web_backend  --type depends_on
$CLI add-edge --id e028 --source l2_web_backend   --target l2_web_frontend --type depends_on
$CLI add-edge --id e029 --source l2_node_crud     --target l2_web_backend  --type depends_on
$CLI add-edge --id e030 --source l2_node_crud     --target l2_mermaid      --type depends_on
$CLI add-edge --id e031 --source l2_edge_crud     --target l2_mermaid      --type depends_on

echo ""
echo "✅ 完整拓扑图创建完成"
