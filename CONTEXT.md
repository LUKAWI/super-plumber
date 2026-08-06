# CONTEXT — Super Plumber（工作流拓扑图管理工具，"轮子"）

> 项目通用语言（Ubiquitous Language）。本文档仅定义领域术语，不含实现细节。
> 品牌名：Super Plumber（npm 包名 `super-plumber`，CLI 命令 `graph`）

---

## 核心概念

### 拓扑图（Graph）

一个工作流的完整拓扑结构 G = (N, E)。包含入口（entry）、出口（exit）、节点集合、边集合和根级共享上下文。

### 节点（Node）

工作流中的一个结构化单元。每个节点是一个"压缩包"——包含构建计划（plan）、预期结果（expected outcome）、检查点（checkpoints）和执行状态。文件系统中对应一个 YAML 文件。

### 边（Edge）

节点之间的有向关系。每条边有明确的类型，表示两个节点之间的具体关联语义。

### 入口（Entry）

拓扑图的起点。由人类定义，表达高层需求或设计初衷。对应 L0 层级。

### 出口（Exit）

拓扑图的终点。由人类定义，表达最终交付物和验收标准。对应 L0 层级。

---

## 节点

### 节点类型（Node Type）

| 类型 | 含义 |
|------|------|
| task | 工作任务单元，有明确的输入输出 |
| checkpoint | 检查点，用于验证前置工作的质量 |
| decision | 决策点，需要人类或 agent 做选择 |
| gate | 门控节点，条件性放行后续流程 |

### 节点层级（Node Level）

拓扑深度层级：

- **L0（主干）**：入口 → 出口，纯人类定义
- **L1（动脉）**：第一层分支，人类 + LLM 共同定义
- **L2（细动脉）**：子任务分解，LLM 展开
- **L3+（毛细血管）**：微观节点，LLM 全权展开

### 节点状态（Node Status）

节点在其生命周期中的当前阶段。状态机：`pending → ready → running → passed / failed / blocked / cancelled`

| 状态 | 含义 | 可转换到 |
|------|------|----------|
| pending | 创建完成，待调度 | ready |
| ready | 前置依赖全部完成，可以执行 | running |
| running | 正在执行 | passed, failed |
| passed | 所有 checkpoints 通过 | blocked |
| failed | 执行失败 | pending（重试） |
| blocked | 下游等待中（前置已完成但系统尚未调度） | ready, failed, cancelled |
| cancelled | 被用户或系统取消 | —（终止态）|

### 构建计划（Plan）

节点要做什么、输入是什么、输出是什么的结构化描述。

### 预期结果（Expected Outcome）

节点完成的定义。包含完成标准（definition of done）和质量门禁（quality gates）。

### 检查点（Checkpoint）

节点内部的子步骤。每个 checkpoint 有独立的 ID、标签、状态和验证方式。状态：`pending | running | passed | failed | skipped`。

### 尝试次数（Attempts）

节点从执行失败状态重试的次数。因执行内容失败时累加；因修改计划后重试时重置为 0。超过 max_attempts 后不再允许重试。

---

## 边

### 边类型（Edge Type）

| 类型 | 符号 | 含义 | 拓扑排序参与 |
|------|------|------|:---:|
| depends_on | A → B | B 依赖 A 完成 | ✅ |
| validates | A → B | A 的输出需要 B 验证 | ✅ |
| shares_context | A ──ctx── B | A 的输出作为 B 的输入上下文 | ❌ |
| fan_out | A → {B, C} | A 完成后 B/C 可并行 | ❌ |
| fan_in | {A, B} → C | C 依赖 A 和 B 都完成 | ❌ |
| fallback | A ←── B | B 失败时可回退到 A | ❌ |
| iterates | A ⇄ B | A 和 B 之间可反复迭代优化 | ❌ |

### 跨边合约（Contract）

边的可选附加结构。定义边两端之间传递的内容契约：produces（产出）、consumed_by（消费方式）和 validation（验证要求）。

---

## 存储

### .graph/ 目录

拓扑图工具的工作目录。包含图根文件、节点、边、快照索引和派生索引。

- **图根文件（graph.yaml）**：入口、出口、根上下文、节点列表、边列表
- **节点文件（nodes/*.yaml）**：单个节点的完整压缩包内容
- **边文件（edges/*.yaml）**：单个边的完整定义
- **派生索引（index/）**：从源文件可重建的缓存（不纳入版本控制的核心索引）

### 真相源（Source of Truth）

YAML 文件（`graph.yaml`、`nodes/*.yaml`、`edges/*.yaml`）是唯一真相源。`index/` 下的派生文件可删除重建。

---

## 架构概念

### 人机分工（Human-LLM Division）

人类定义两端（入口 + 出口），LLM 展开毛细血管级子图、编排边、管理 checkpoint、验证输出。

### 血管隐喻（Vascular Metaphor）

将工作流拓扑类比为血管系统：人类定位主动脉（入口→出口），LLM 逐级展开细动脉到毛细血管（L1→L2→L3+）。

### 马里奥水管工（Mario Plumber）

专用验证 subagent 的隐喻。Mario 按图跳跃到每个节点，解压"压缩包"，核对预期输出 vs 实际输出，更新 checkpoint 状态，决定前进/回退/请求人类介入。

### Super Mario

职责合并后的拓扑管理主控 subagent。承担：节点生命周期裁决（checkpoint 聚合 + 实际输出抽查）、重试管理、状态监测、进度同步检查。与执行 agent 职责分离——执行 agent 只报 checkpoint 进度，Super Mario 裁决节点状态。

### 执行 agent（Executor）

执行具体任务的 subagent（或集群）。职责：认领（claim）ready 节点为 running、执行任务、逐项上报 checkpoint 进度、填写执行报告。不负责节点状态的最终裁决。

### 认领（Claim）

执行 agent 将节点从 ready 置为 running 的动作。通过扩展后的 update_node_status 完成，自动记录 assigned_to 和 started_at。状态机原子性保证同一节点不可被重复认领。

### 执行报告（Execution Report）

执行 agent 写给 Super Mario 的"交接单"，存储在节点的 execution_report 字段中。包含 summary（执行摘要）、artifacts（产物路径，供抽查）、blockers（阻塞原因）、notes（补充说明）。

### 进度同步检查（Progress Sync Check）

主 agent 每轮决策前，调用 Super Mario 对 running 节点做快速扫描，识别长时间无更新的"疑似卡住"节点并提醒。这是"提醒 agent 做完即同步"的强制机制。

---

## 工具边界

### 轮子（Wheel）

本工具只做"管理图拓扑"——定义图结构、管理节点和边、维护状态、可视化拓扑。不做执行引擎、不做验证 agent、不依赖 LLM API。

### 轮子的外部关系

| 系统 | 关系 |
|------|------|
| CodeGraph | 互补：本工具管理将要执行的工作流拓扑，CodeGraph 索引已有代码的拓扑 |
| Workflow DAG | 可选执行后端：本工具生成的拓扑可由 workflow 调度器执行 |
| 执行引擎 | 后续阶段建造，不在轮子范围内 |
| Mario 验证 agent | 后续阶段建造，不在轮子范围内 |
