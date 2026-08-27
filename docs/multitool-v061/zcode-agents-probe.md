# zcode 项目级 agents 目录扫描探针记录

- 日期：2026-08-27
- 执行者：prober-zcode
- 节点：`l2_zcode_probe`（multitool-refactor 图，W1 波次）
- 方法性质：纯静态证据链（bundle 字符串搜索），无任何交互式 GUI 尝试、未改动 `~/.zcode` 下任何文件。

## 一、问题

zcode 官方配置指南记载了项目级 skills 目录 `<repo>/.zcode/skills/` 会被扫描，但从未记载 `<repo>/.zcode/agents/` 是否被扫描。本探针从主程序 bundle 的静态证据一锤定音。

## 二、方法

### 2.1 bundle 定位

任务书预估 `~/.zcode/cli/` 下是程序目录，实测其为**运行时数据目录**（agents/artifacts/config.json/db/exec/log/memories/plugins/rollout）。真正的安装位置：

- 桌面端：`C:\Users\liujiayu\AppData\Local\Programs\ZCode\`（Electron 应用）
- **主程序 bundle（本探针目标）**：`C:\Users\liujiayu\AppData\Local\Programs\ZCode\resources\glm\zcode.cjs`
  - 12,494,088 字节，esbuild 打包的明文 Node.js 脚本（文件头 `#!/usr/bin/env node`），行超长（grep -n 行号仅几十~三千余行），故以下定位采用 **grep 行号 + 字节偏移（offset）** 双标注。
- 另有 `resources/app.asar`（297MB）为桌面壳；`resources/glm/packages/` 为内置插件 seed 包。均非核心逻辑载体，未作为主要搜索面。

### 2.2 搜索串与方法演进

第一轮直接搜整串 **均零命中**：`.zcode/skills`、`.zcode/agents`、`loadAgents`、`scanAgents`、`agentDir`、`agentsDirectory`。

原因（方法学关键点）：路径由 `path.join` 动态拼接，目录名以独立常量/字面量存在于代码中，不形成连续路径字符串。第二轮改为结构化搜索后全部命中：

1. `\.zcode\b` → 66 处；提取每处 ±250 字节上下文，按含 `skills|agents|Agents` 过滤；
2. `"agents"`（带引号字面量）→ 16 处；
3. `bootstrap.subagents`（日志模块名）→ 4 处，恰与 agent 装载函数重合；
4. `kind==="agent"` → 2 处（插件组件模型）；
5. `function hin` → agent md 扫描器实现及 esbuild 名称注册表。

### 2.3 对照组有效性判定

**有效，但需修正方法后判定。** 直接串搜索对照组失败的原因不是加密/压缩（bundle 为纯 ASCII 明文 JS），而是拼接写法。用结构化搜索验证对照组成功：

- skill 根常量区（line 892 附近区域，offset≈6972911）：
  ```js
  sIo=".git",Nfr="~/",uIo=10,Lfr="skills",lIo=".zcode",cIo=".agents";
  s(Ffr,"resolveDefaultSkillRoots");s(dIo,"resolveProjectSkillDirectories");...
  ```
  官方文档明确记载的项目级 skills 支持在代码中确实存在 → 同等搜索法得到的 agents 命中可信。
- commands 根常量区（offset≈6981052）：`$fr="commands",...DIo=".zcode",NIo=".agents"; s(Hfr,"resolveDefaultCustomCommandRoots")` — 同构佐证。
- 附带发现：skills 与 commands 的项目级扫描同时接受 `.zcode/` 与 `.agents/` 两种前缀。

**结论：搜索方法有效，bundle 可读，非混淆阻碍。**

## 三、命中证据（每条：文件 + grep 行号 + 字节偏移 + 摘录）

以下简写 `<BUNDLE>` = `C:\Users\liujiayu\AppData\Local\Programs\ZCode\resources\glm\zcode.cjs`。

### 证据 1（决定性）：项目级 `.zcode/agents` 硬编码于 agent profile 装载根列表

`<BUNDLE>` line 3101, offset 11837395 起（grep 关键词 `bootstrap.subagents` / `".zcode"`）：

```js
function min(e){
  let t=[
    {path:(0,BG.join)(e.storageRoot,"agents"),source:"user"},              // ~/.zcode/agents
    {path:(0,BG.join)(e.workingDirectory,".zcode","agents"),source:"project"} // <repo>/.zcode/agents
  ], ...
  for(let i of t) for(let a of hin(i.path)){           // hin() 递归扫 .md/.markdown
    let u=(0,Vw.readFileSync)(a,"utf8"),
        l=bpt({content:u,path:a,source:i.source});     // 解析 md frontmatter 为 profile
    ... o.push(c)
  }
  return e.logger?.debug("Agent profiles loaded",{...,module:"bootstrap.subagents",profileCount:o.length}),...
}
```

装载根同时包含用户级与项目级，项目级标记 `source:"project"`。

### 证据 2：正式函数名注册表（语义自证）

`<BUNDLE>` line 3101, offset ≈11840904 之后（esbuild `s()` 名称标注揭示压缩前的真实函数名）：

```js
function hin(e){ if(!existsSync(e))return[]; if(!statSync(e).isDirectory())return[];
  for(let r of readdirSync(e,{withFileTypes:!0})){
    if(r.isDirectory()){t.push(...hin(join(e,r.name)));continue}     // 递归子目录
    r.isFile()&&/\.(md|markdown)$/iu.test(r.name)&&t.push(n)          // 只收 .md/.markdown
  } return t.sort(...) }
KEi=new Set(["general-purpose","Explore"]);                            // 保留名
s(min,"loadZCodeAgentProfiles");
s(JEi,"sanitizeProjectAgentProfile");
s(fin,"loadPluginAgentProfiles");
```

- `min` 正式名 **loadZCodeAgentProfiles** —— zcode 自定义 subagent 定义的总装载入口；
- `JEi` 正式名 **sanitizeProjectAgentProfile** —— 项目级来源有专门清洗分支（见证据 3）。

### 证据 3：project 来源是一等公民且有专属安全约束

offset ≈11838365 后：

```js
function JEi(e){
  if(e.source!=="project"||e.permissionMode===void 0)return e;
  let{permissionMode:t,...r}=e; return r   // 项目级 agent 的 permissionMode 被强制剥离
}
```

项目级 agents 若在 frontmatter 写了 `permissionMode` 会被**静默忽略**。这是使用注意点：权限相关字段只在用户级定义中生效。

### 证据 4（插件内置 agents 路由的真实性佐证）

- offset 11838365 附近，`fin`=loadPluginAgentProfiles：对每个启用插件的 `components` 中 `kind==="agent"` 的项，读取 `join(a.rootPath,"agents","${l.name}.md")`，命名空间化为 `${plugin.name}:${bareName}`；
- offset 10494282，插件冲突清单构建 `vYo`：收集每个启用插件 `components` 中 `kind==="agent"` 的条目生成 `subagentNames`；
- 冲突诊断码 `agent_ambiguous_name`：裸名与其他 profile 冲突时要求用全限定名调用。
- **实证先例缺位**：官方插件 cache（18 个 plugin.json，含 zcode-cua 0.5.10/0.5.12、zcode-guide 0.1.0、browser-use 0.4.0 等）无一携带 agents 目录或 agent 组件——现有官方包只用了 `"skills":"skills"` 字段。即"插件内置 agents"机制代码完备且可用，但尚无官方实例可抄写声明格式；从 `fin` 实现看走的是**约定目录** `<plugin-root>/agents/*.md` + 组件自动发现，plugin.json 无需显式 agents 字段。

### 证据 5（用户级旁证）

`C:\Users\liujiayu\.zcode\agents\` 下确有 6 个 md：
hephaestus.md、librarian.md、oracle.md、sisyphus-junior.md、sp-designer.md、super-mario.md，
与本会话 subagent 实际工作状态吻合（既成事实旁证用户级路径被扫描）。

### 未检查项（如实记录）

zcode CLI 无头只读子命令（如 agents/list 类）**跳过**：`command -v zcode` 无结果，`AppData/Roaming/npm` bin 无 zcode*，唯一可执行入口是 Electron GUI（ZCode.exe）。按任务红线不登录、不拉起交互会话，此项放弃。

## 四、结论

**A —— 项目级 `<repo>/.zcode/agents/` 明确被支持。置信度：高（95%+）。**

依据强度递减：(1) 证据 1 直接硬编码双根列表；(2) 证据 3 的 project 分支表明这不是残留死代码而是被显式设计的特性；(3) 证据 5 用户级现实吻合同一装载器。唯一保留意见：静态分析无法排除运行时 `workingDirectory` 在 worktree 场景下偏离仓库根的可能，但对常规单仓场景不影响结论。

使用注意（项目级 md 与用户级的差异）：frontmatter 中 `permissionMode` 会被剥离忽略；保留名 `general-purpose`、`Explore` 不可占用。

## 五、对 README 的影响建议

按预设映射规则 A → **增补说明**：

1. README 可增补「免装插件的轻量路径」一段：把 subagent 定义 md 复制到 `<repo>/.zcode/agents/<name>.md` 即被 zcode 发现，无需安装任何插件；并注明该路径 frontmatter 不支持 permissionMode。
2. 首选路由维持不变：插件内置 agents（约定目录 `<plugin>/agents/*.md`，装载后命名空间化为 `插件名:名字`，避免冲突）仍是分发正道——项目级放 agents 会把私有角色混进业务 repo、且无法随 npm 包分发。
3. 降级链第 2 级描述改为：「项目级 .zcode/agents（免插件轻量路径，permissionMode 受限）」置于「用户级兜底复制」之前。

## 六、交叉评审提示

复核点：(a) 2.2 节对照方法修正是否成立（直接串搜零命中的解释）；(b) 证据 1–3 的摘录是否支持 A 结论；(c) boundary 回写是否完整保留了原文。
