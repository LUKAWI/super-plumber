<!-- 附件（0.9.4 S02 分层，adr_0008）：三级路由细则。唯一正本 integrations/src/skills/plumber-design/attachments/；
     .pi 与插件包内同名文件是 gen 产物，手改会被 scripts/sync-integrations.mjs --check 拦截。
     寻址：与 plumber-design/SKILL.md 同目录 attachments/（两渠道同构，相对本文件可解析）。 -->

# Workflow Classes — 三级路由细则（quick / standard / program）

何时读：接需求定档（design Phase 0）、执行期升降档、对档位凭据纪律有疑问时（DEC-2、adr_0016）。

## 两问定档（先于 Step 1；DEC-2）

对需求问两问：**① 有雾吗**（存在说不出精确问题的未知区）？**② 一个会话装得下吗**？按答案锁定档位，后续步骤按档取舍：

| 档位 | 判定 | 走法 |
|------|------|------|
| **quick** | 无雾 + 装得下 | 单节点图：entry=任务一句话、exit=验收一句话；跳过 serve 人审与 doctor 质检，只跑 `graph validate`；执行协议减为 claim→report→passed（checkpoint 可选）；init 后立即 `graph approve --by <agent 名> --status self` 自签（自签是话术约定：无 --self 参数，用 `--status self` 表达） |
| **standard** | 无雾 + 装不下 | plumber-design 全流程（Step 1–5 一项不减） |
| **program** | 有雾 / 跨会话 / 跨图 | 走 chart the graph 模式（→ `wayfinder-mode.md`）：绘图会话只画图不解题，解雾交 work 模式（0.9.0 雾区进 schema） |

定档拿不准时升档执行（存疑按 standard 走）；定档后冒出雾 → 回本表重定档。

## 档位凭据纪律（adr_0016）

- 用户未设档时由 agent 按上表自判档位（现状维持，缺省 `--by` 即 agent 自判）。
- 用户说「设为某档」=凭据效力（pi 对话约定，与 `/plumber-class` 命令同款），agent 代发 `graph update-graph --class <档>` 须带 `--by user`——血统落 class_changed 审计事件，与用户直发可区分。
- 升降档须用户批准；执行期降档向（→quick）从严。
- 雾/档矛盾由读面 `class_nudge` 提示，用户直发 `--by user` 凭据后静默（→ 手册 §4.1；寻址约定见手册 §11）。
