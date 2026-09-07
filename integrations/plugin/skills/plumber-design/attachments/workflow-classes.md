<!-- 附件（0.9.4 S02 分层，adr_0008）：三级路由细则。唯一正本 integrations/src/skills/plumber-design/attachments/；
     .pi 与插件包内同名文件是 gen 产物，手改会被 scripts/sync-integrations.mjs --check 拦截。
     寻址：与 plumber-design/SKILL.md 同目录 attachments/（两渠道同构，相对本文件可解析）。 -->

# Workflow Classes — 三级路由细则（quick / standard / program）

何时读：接需求定档（design Phase 0）、执行期升降档、对档位凭据纪律有疑问时（adr_0018（修订 DEC-2）、adr_0016）。

## 两问定档（先于 Step 1；DEC-2，adr_0018 修订）

按顺序判定：**① 关键未知是否阻止形成可信交付计划？** 是 → program；否 → **② 一个会话内能完成并验收吗？** 是 → quick，否 → standard。会话数、图数、仓库数和并行人数不单独触发 program。

| 档位 | 判定 | 走法 |
|------|------|------|
| **quick** | 可信交付计划可成立 + 一个会话能完成并验收 | 单节点图：entry=任务一句话、exit=验收一句话；跳过 serve 人审与 doctor 质检，只跑 `graph validate`；执行协议减为 claim→report→passed（checkpoint 可选）；init 后立即 `graph approve --by <agent 名> --status self` 自签（自签是话术约定：无 --self 参数，用 `--status self` 表达） |
| **standard** | 可信交付计划可成立 + 一个会话装不下 | plumber-design 全流程（Step 1–5 一项不减）；允许跨会话、跨图、跨仓库及多 agent 协作 |
| **program** | 关键未知阻止形成可信交付计划 | 走 chart the graph 模式（→ `wayfinder-mode.md`）：先画已知骨架、登记关键未知和当前研究任务，经阶段审核后交 work 模式解雾 |

**可信交付计划**：目标、范围和验收明确，主要任务与关键依赖可以列出；剩余未知可在具体节点内解决，不必等研究结果才能决定主要方案。无需提前确定每个实现细节，执行中允许正常修订计划。

**关键未知**：答案会决定交付范围、主要方案或关键依赖，导致当前无法可信地拆出完整交付计划。登记 fog 时在 `description` 写清「未知是什么、影响哪些后续决定」，在 `graduation` 写清「取得什么可验证证据才算解决」；沿用现有字段，不新增 schema。

| 判定示例 | 档位与理由 |
|---|---|
| 五个模块、十个会话，接口和验收明确 | standard：工作量大但计划能成立 |
| 两个仓库协作，契约和先后顺序明确 | standard：跨仓库不是关键未知 |
| 查某个 API 的用法，或在节点内定位局部缺陷 | standard（整项工作可在一个会话完成并验收则 quick）：节点内部问题不触发 program |
| 性能实验结果决定集中式还是分布式架构 | program：研究结果决定主要方案和任务结构 |
| 只说「改善体验」，没有范围或成功指标 | 先澄清需求；不能仅因描述模糊就自动启动 program |
| 已明确通过用户研究确定问题与成功指标 | program：研究有明确目的和可检查的产出 |

**转档**：standard 发现使主要计划失效的关键未知 → 提出转 program；单个节点遇到困难不自动升档。program 的关键未知已解决、可信交付计划可成立且经增量人审 → 转 standard；研究票全部 passed 或 fog 字段清空都不足以单独触发降档。详见 `wayfinder-mode.md`。

**存疑处理**：先查事实或澄清未知的影响；不能以「拿不准」跳过第一问。仅对会话容量存疑时按 standard 走。定档后出现新的关键未知 → 回本表重判，变更凭据遵守下节。

## 档位凭据纪律（adr_0016）

- 用户未设档时由 agent 按上表自判档位（现状维持，缺省 `--by` 即 agent 自判）。
- 用户说「设为某档」或明确批准档位即构成凭据，agent 代发 `graph update-graph --class <档>` 须带 `--by user`——血统落 class_changed 审计事件，与 agent 自判可区分。
- 升降档须用户批准；执行期降档向（→quick）从严。
- 雾/档矛盾由读面 `class_nudge` 提示，用户直发 `--by user` 凭据后静默（→ 手册 §4.1；寻址约定见手册 §11）。
