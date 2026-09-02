---
description: 给当前图设定/变更工作类档位（quick|standard|program）——用户直发的档位凭据命令，agent 代发必带 --by user 落 class_changed 审计血统
---
<!--
super-plumber 斜杠命令正本 · v0.9.1（plumber-class）
正本唯一性：本文件是 /plumber-class 文案的唯一权威源，改文案只改这里。
构建期同步约定（scripts/sync-integrations.mjs 消费）：
  - 拷贝目标：integrations/plugin/commands/plumber-class.md
               plumber-class.md    两件拷贝与本正本内容一致、sha256 一致；禁止手改拷贝件。
  - pi 集成无 slash-command 机制，本正本不向 .pi/ 拷贝。
三包路径约定以 docs/multitool-v061/integration-blueprint.md §3 映射表为准。

# /plumber-class

**定位**：把工作类档位（quick|standard|program，DEC-2）的设定/变更凭据交到用户手里——用户直发的档位命令，与 agent 自判档位（plumber-design Phase 0）凭血统可区分。

**使用时机**：
- 用户明确说"设为 quick/standard/program""升到 program""降回 quick"等档位指令；
- agent 报告雾/档矛盾提示（图有未毕业雾区而非 program 档）后，用户拍板定档；
- 不适用：用户未表态时 agent 按判档表自判（走 plumber-design Phase 0，缺省 --by 即 agent 自判）；雾区登记/毕业（update-graph --set-fog / graduate-fog）；设计审核凭据（graph approve）。

**执行指令**：执行 `graph update-graph --class <档> --by user`——**--by user 必带**（本命令的凭据效力就在这里：class_changed 审计事件记 by=user，雾/档矛盾提示据此静默）；随后回显生效结果：`graph status` 可查当前 class，`graph events --kind class_changed` 可查变更血统（from/to/by）。**档位非法时提示三值**：仅允许 quick | standard | program（收到其他值不落盘）。

**硬约定提醒**：升降档是用户决定——agent 不得借本命令代用户拍板；用户对话里说"设为某档"与敲本命令同效力（pi 对话约定，plumber-design/plumber-execute skill 同款话术）。

**深读指引**：参数全集与 class_changed 事件行为见 integrations/shared/manual.md §2.2（design-ops）；插件包内按寻址约定 `Read ./manual.md §2.2`。

**参数位说明**：$ARGUMENTS 原样透传，作为目标档位（quick|standard|program），不做模板展开。
