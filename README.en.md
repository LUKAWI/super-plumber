# Super Plumber 🚰 — Make AI Agents Work From a Topology Graph

> Turn "task documents" into **graphs agents can natively understand**: nodes are self-contained packages with plans and acceptance criteria, edges are typed dependencies, a state machine owns the lifecycle.
> One install, three access layers (CLI / MCP / a starfield Web UI), pure YAML file storage — no database, no server, Git is your version control.

[![npm version](https://img.shields.io/npm/v/@lukawi/super-plumber)](https://www.npmjs.com/package/@lukawi/super-plumber)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-LUKAWI%2Fsuper--plumber-black)](https://github.com/LUKAWI/super-plumber)

**中文版:** [README.md](README.md) · **npm:** [@lukawi/super-plumber](https://www.npmjs.com/package/@lukawi/super-plumber)

---

### Workflow classes

Choose **program** when a critical unknown prevents a credible delivery plan: research first, then refine and review the plan in stages. Otherwise, choose **quick** if the work can be completed and accepted in one session, or **standard** for larger work. A credible plan defines the goal, scope, acceptance criteria, main tasks, and key dependencies; implementation questions resolvable within a task do not require program. Multiple sessions, graphs, repositories, or agents alone do not trigger program. Returning to standard requires resolved critical unknowns and an incrementally reviewed credible delivery plan; completed research tasks or an empty fog field alone are insufficient.

See the [workflow class rules](integrations/plugin/skills/plumber-design/attachments/workflow-classes.md) for examples.

## Why Super Plumber?

A Todo list is just lines of text — no ordering, no acceptance criteria, no lifecycle. Hand that to an AI agent and it has to guess what you meant.

Super Plumber restructures your workflow as a **graph**:

```text
todo: "build a registration module"  →   entry → l1_register → l1_login → exit
                                          ↳ each node = plan + checkpoints + definition of done
                                          ↳ each edge = typed dependency (who comes first, who validates whom)
                                          ↳ each state = enforced by a state machine (no skipping steps)
```

- **For humans**: a structure you can read at a glance, a starfield wall-mount visualization, plain-text files you can commit to Git.
- **For AI agents**: read the graph, claim tasks, and report progress over MCP — every node is a self-contained package. No guessing.

---

## What Makes It Different?

The market doesn't lack task trackers; it lacks a **workflow foundation built for agents**. Where Super Plumber stands apart:

**① Structure over prose — not another Markdown cloud**
Todo tools feed agents text that must be guessed at. Here agents get a schema-constrained graph — dependencies feed the topological sort, the `ready` gate blocks skipped steps, and the `passed` hard gate rejects "done" without a handoff report. Want to bluff completion? The state machine says no.

**② Agents are first-class users; humans supervise**
24 MCP tools cover the whole design→execute→adjudicate loop: atomic claims (exactly one concurrent winner), step-by-step checkpoint reporting, handoff reports (summary + artifacts) persisted to disk, dead-claim reclamation, and an append-only audit log. Read endpoints paginate everywhere — large graphs never blow the agent's context window.

**③ A starfield observatory you won't find anywhere else**
`graph serve` opens not another dashboard grid but a **starfield you can leave on a wall-mounted screen all afternoon**: every task is an eight-point star, status colors breathe along the rays, energy flows along edges from `running` nodes, domains glow as nebulae, a galaxy band stretches across the background. Focus mode removes every piece of chrome — one glance tells you what's running and what's stuck.

**④ Domain modeling is a first-class citizen, not a comment**
Bounded contexts are graph vertices (boundary + glossary — node as document) and ADRs are decision vertices with a three-state machine — superseding requires a successor, and a superseded decision automatically propagates a "stale decision basis ⚠️" warning along decides edges. `graph export --docs` regenerates domain docs from the graph — the graph is the source of truth, the docs are a view.

**⑤ A multi-agent adjudication protocol out of the box**
`sp-designer` (topology design) and `super-mario` (adjudication) subagents plus two staged skills: a hard review gate in the design phase, three-layer acceptance in execution (all states green + structure validation + deliverables checked against exit criteria). Solo? The solo adjudication boundary is a written rule — mechanical checks may self-adjudicate; judgment calls always stop for a human.

**⑥ Plain files, Git as version control**
One YAML file per node/edge. No database, no server. Snapshot/diff/rollback primitives + an append-only audit log; branch/merge stays with Git.

---

## Feature Highlights

| Capability | Description |
|------------|-------------|
| 🌌 **Starfield visualization (v0.7.0 "Deep-Space Instrument Bay")** | Starfield canvas + instrument-glass chrome: single-row console bar, floating glass dock, graph-library popover, unified right-edge detail drawers, focus mode for wall-mount monitoring — see [Web UI](#web-ui-starfield-observatory-svelte-5--d3js) |
| 🗂️ **Multi-graph workspace (v0.5.2)** | One `.graph/` manages multiple named graphs: `graph switch` like git branch (workspace default + per-process MCP active, two-layer semantics), `graph init <name>`/`list`/`rename-graph`/`delete-graph` (.trash soft delete), `--graph` flag and `SUPER_PLUMBER_GRAPH` on every command; legacy repos stay compatible (one-shot locked migration when the second graph is born); per-graph locks/index/events/snapshots |
| 🧭 **Typed topology** | 9 edge types: `depends_on` / `validates` participate in topological sort; `shares_context` / `fan_out` / `fan_in` / `fallback` / `iterates` express runtime control flow; `decides` / `relates` (v0.5) carry domain knowledge |
| 🏛️ **Domain semantics (v0.5)** | **Bounded contexts and ADRs are first-class graph citizens**: context vertices follow "node as document" (boundary + glossary); node membership (`--context`) derives workflow/domain maps; **ADR state machine** proposed→accepted→superseded (supersede requires a successor; propose/adjudicate separation); `graph adr` command group + MCP `graph_create_adr`; decision changes propagate along decides edges (claim responses inject `governing_adrs` pointers, scheduling entries get `adr_flags` ⚠️); cross-context workflow edges are contract edges (contract required); `graph export --docs` regenerates docs/adr + CONTEXT-MAP.md + per-context CONTEXT.md (graph is the source of truth, markdown is a view) |
| 🔄 **Enforced state machine** | 7 states + three hard rules: ready gate (gating predecessors must be `passed`), max_attempts cap, and a **passed hard gate** (no execution report / unaggregated checkpoints / failed verdict → `passed` rejected); concurrent claims are atomic under a lock; knowledge vertices are exempt (context is stateless, ADR has its own 3-state machine) |
| 🛡️ **Schema validation** | Every YAML file is validated on read (enums/types/required fields) with readable errors; `graph validate` locates issues per file + six domain rules (dangling membership=error, duplicate glossary terms=warning, cross-context missing contract=warning, relates endpoints=error, orphan ADR=warning, decides source=error) |
| 🗂️ **Versioning** | `snapshot` / `diff` / `rollback` primitives (auto-backup before rollback, explicit confirm required; **design-only rollback** rewinds design fields while keeping execution progress); Branch/Merge stays with Git |
| 🧾 **Event log** | `.graph/events.jsonl` append-only audit: who created/deleted/transitioned/claimed/overrode/reset/rolled back what and when, including the ADR lifecycle (adr_created/accepted/superseded) — `graph events` for one-command traceability |
| 🤖 **Native MCP** | 26 `graph_*` tools covering the whole flow: design (batch create / add edge / edit entry-exit / **graph_create_adr**), execution (atomic claim with governing-ADR pointers / checkpoint / report / **reclaim of dead claims**), adjudication (verdict), versioning (snapshot/diff/rollback), self-check (**graph_validate**: structure + domain rules + reference drift), audit (**graph_events**: event-log replay) — all with zod-validated params |
| 🎯 **Scheduling decisions** | `graph next` / `graph_get_next_actions` returns claimable / ready-eligible (cold-start entry) / waiting-on-deps / running / possibly-stale in one screen, with per-bucket pagination + truncated flags; ready buckets ordered by node `priority`; staleness = last activity (reporting acts as a heartbeat); entries may carry `adr_flags` (stale decision basis ⚠️); knowledge vertices never enter scheduling buckets — the agent planning loop's first call |
| 📉 **Context economy** | All MCP read endpoints paginate: `graph_get_graph` defaults to summary mode (compact fields) + paginated full mode, `graph_search` limit, `graph_traverse` max_nodes, `graph_get_node` optional topology neighbors — no more token explosions on large graphs; ADRs are injected as title-level pointers only, never full-text |
| ⚡ **Large-graph hot paths** | Two-level index cache (in-memory + on-disk graph.json): gate/scheduling drop from full-graph scans (~9s @10k) to table lookup + single-file reads; scheduling is O(N+M); **write paths actively invalidate the cache** (no betting on filesystem mtimes — long-running processes read-after-write consistent) |
| 📁 **File-first storage** | One YAML file per node/edge, Git as the single source of truth, human-editable, no database |
| 🧩 **Agent collaboration protocol** | Built-in `plumber-design` (topology design + domain modeling + ADR triage + preview review gate) and `plumber-execute` (topology execution + 3-layer acceptance + governing-ADR discipline) skills + 2 dedicated subagents (designer / adjudicator) |

---

## Installation (step by step)

### Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| Node.js | **≥ 20** (with npm) | `node --version` |
| Platform | Windows / macOS / Linux | — |

> No Node.js? Grab the LTS installer from [nodejs.org](https://nodejs.org) (defaults are fine).

### 1. Install globally

```bash
npm install -g @lukawi/super-plumber
```

> Behind a corporate proxy or firewall? Check the registry is reachable, or point npm at it explicitly:
>
> ```bash
> npm config get registry        # should be https://registry.npmjs.org/
> npm install -g @lukawi/super-plumber --registry=https://registry.npmjs.org
> ```

### 2. Verify the install

```bash
graph --version     # prints the version → success
graph --help        # lists all 27 commands
which graph         # confirm location (Windows: where graph)
```

### 3. Try it in a fresh directory

```bash
mkdir ~/my-first-graph && cd ~/my-first-graph
graph init my-first-graph -l "My first topology"
```

You should see `✅ 已创建图 "my-first-graph" 并设为工作区默认`. A `.graph/` folder now exists in the directory — your graph's data lives in `.graph/my-first-graph/`.

---

## Quick Start (a graph in 2 minutes)

```bash
# 1. Initialize (v0.5.2: a fresh repo requires a content-named graph name)
graph init user-registration -l "User Registration"

# 2. Create nodes (-i id, -l label, --level, --plan-desc plan, --dod repeatable)
graph create-node -i l1_register -l "Registration" -t task --level 1 \
  --plan-desc "Email + password registration" --dod "Register API works" --dod "Passwords hashed"

graph create-node -i l1_login -l "Login" -t task --level 1 \
  --plan-desc "Login + session handling" --dod "Login API works"

# 3. Add a dependency edge (l1_login depends on l1_register)
graph add-edge -i e1 -s l1_register -t l1_login --type depends_on

# 4. View status
graph status

# 5. Validate (reference integrity + topo sort + cycle detection)
graph validate

# 6. Visualize
graph serve    # starts the service and auto-opens the browser (headless: graph serve --no-open)
```

---

## Full Tutorial: a graph from zero to delivery

We'll build a "User Registration" module through the complete lifecycle.

### Step 1 — Initialize and design entry/exit

```bash
graph init user-registration -l "User Registration"
```

Every graph has exactly one **entry** (the requirement) and one **exit** (the acceptance criteria), both at level 0. Fill them in with `graph update-graph` (no hand-editing graph.yaml anymore):

```bash
graph update-graph \
  --entry-desc "Build a user registration module: email+password signup and login" \
  --exit-desc "Working registration/login, all tests pass" \
  --add-criteria "Register API works" --add-criteria "Login keeps a session"
```

> `graph validate` warns when entry/exit are empty — a hint, not an error. Fill them in and the warning goes away.

### Step 2 — Create nodes (each node is a package)

A node = **id + label + plan + checkpoints + definition_of_done**:

```bash
# Backbone node: with plan, DoD, assignee
graph create-node -i l1_register -l "Registration" -t task --level 1 \
  --plan-desc "Email + password registration: endpoint, validation, storage" \
  --dod "Register API returns 200" --dod "bcrypt password hashing" --dod "Duplicate email rejected" \
  --assigned-to "backend-agent"

# Child nodes: executable granularity
graph create-node -i l2_reg_api -l "Registration endpoint" -t task --level 2 \
  --plan-desc "POST /register endpoint" --dod "Endpoint tests pass"

graph create-node -i l2_reg_store -l "User storage" -t task --level 2 \
  --plan-desc "User table + password hashing" --dod "Storage tests pass"
```

Add **checkpoints** (sub-steps reported during execution):

```bash
graph update-node -i l1_register \
  --add-checkpoint '{"id":"cp1","label":"Endpoint"}' \
  --add-checkpoint '{"id":"cp2","label":"Password hashing"}' \
  --add-checkpoint '{"id":"cp3","label":"Integration test"}'

# Inspect the full node
graph update-node -i l1_register --show
```

### Step 3 — Connect edges (7 workflow + 2 knowledge types)

```bash
graph add-edge -i e1 -s l1_register -t l1_login --type depends_on
graph add-edge -i e2 -s l2_reg_api -t l2_reg_store --type depends_on
graph add-edge -i e3 -s l2_reg_api -t l1_register --type validates    # validation relation
graph add-edge -i e4 -s l1_register -t l1_login --type shares_context # shared context
```

| Edge type | Semantics | Topo sort |
|-----------|-----------|:---------:|
| `depends_on` | Order dependency: B needs A done | ✅ |
| `validates` | Validation: A's output is verified by B | ✅ |
| `shares_context` | A's output feeds B as context | ❌ |
| `fan_out` | After A, multiple downstream tasks may run in parallel | ❌ |
| `fan_in` | C waits for multiple upstream completions | ❌ |
| `fallback` | On B's failure, retry with A | ❌ |
| `iterates` | A ⇄ B iterate | ❌ |
| `decides` | ADR → any vertex: decision governance; staleness propagates as adr_flags (v0.5 knowledge edge) | ❌ |
| `relates` | context ↔ context: domain relation, free-form `--rel-kind` (v0.5 knowledge edge) | ❌ |

> `depends_on` / `validates` participate in the topological sort; the other workflow edges express runtime control flow and are ignored by sorting (a `fallback` back-reference won't false-positive as a cycle); knowledge edges (`decides` / `relates`) never join sorting or gating.

### Step 4 — Validate

```bash
graph validate
```

Expected output:

```text
✅ 节点: 3 个
✅ 边: 4 条
✅ 拓扑排序: 3 节点通过
✅ 循环检测: 无环路
📊 结果: 0 错误, 0 警告
```

> **Try creating a cycle on purpose**: `graph add-edge -i e_cycle -s l1_login -t l1_register --type depends_on` — validate reports `检测到循环依赖: l1_register → l1_login → l1_register`. The tool won't let you ship a cycle.

### Step 5 — Execute (state-machine driven, claimed by agent or human)

```bash
# State machine: pending → ready → running → passed
graph update-status -i l1_register -s ready      # predecessors done → eligible
graph update-status -i l1_register -s running    # claim: records started_at (--claim-by <agent>)
graph update-status -i l1_register -s passed     # done

# Try skipping steps — the state machine blocks it:
graph update-status -i l1_login -s running
# ❌ Invalid transition: pending → running. Allowed: [ready, cancelled]
```

> Full machine: `pending → ready → running → passed → blocked`, `running → failed → pending` (retry, attempts accumulate), any state → `cancelled`.

**Report checkpoints and the handoff report** (no CLI commands for these — use MCP tools or skill scripts):

Option A · MCP tools (agent connected, see MCP below):

```json
// graph_update_checkpoint: { node_id: "l1_register", checkpoint_id: "cp1", status: "passed" }
// graph_update_execution_report: { node_id: "l1_register", summary: "Registration done", artifacts: ["dist/register.js"] }
```

Option B · skill scripts (shipped with the `plumber-execute` skill; for pi at `~/.pi/agent/skills/plumber-execute/scripts/`, in-project at `.pi/skills/plumber-execute/scripts/`):

```bash
SCRIPTS=~/.pi/agent/skills/plumber-execute/scripts

node $SCRIPTS/sp.mjs claim l1_register backend-agent
node $SCRIPTS/sp.mjs checkpoint l1_register cp1 passed
node $SCRIPTS/sp.mjs report l1_register "Registration done" "dist/register.js,test/register.test.js" "" "bcrypt hashing"
```

### Step 6 — Visualize and share

```bash
graph export --mermaid -o flow.mmd    # Mermaid export (knowledge-vertex shapes/colors + edge styles, entry/exit + legend in the header)
graph serve                           # open http://localhost:8934 to see the starfield
```

---

## CLI reference (27 commands)

| Command | Purpose | Common flags |
|---------|---------|--------------|
| `graph init` | Initialize: new repos must name the graph (v0.5.2); naming init on a legacy repo = migrate + create | `<name>`; `-l <label>`; `--force` |
| `graph switch` | Switch the workspace default graph (writes `.graph/active`); no args shows current (with source) | `[<name>]` |
| `graph list` | List all graphs (or inspect one) | `[<name>]`; `--json` |
| `graph rename-graph` | Rename a graph (directory moves + active fixed + audited); CLI-human only | `-o <old>` `-n <new>` |
| `graph delete-graph` | Delete a graph (soft-delete to `.trash/`; refuses last/default); CLI-human only | `-i <name>` `--confirm` |
| `graph create-node` | Create a node (plan & DoD inline; checkpoints via `update-node`) | `-i <id>` `-l <label>` `-t <type>`(task/checkpoint/decision/gate/context/adr) `--level <n>` `--priority <n>` `--context <ctx_id>` `--plan-desc <text>` `--dod <item>`(repeatable) `--assigned-to <agent>` |
| `graph get-node` | Read node + legal transitions + gate status (+topology neighbors) | `-i <id>`; `--json`; `--neighbors up\|down\|none` |
| `graph add-edge` | Add an edge (endpoint existence checked) | `-i <id>` `-s <source>` `-t <target>` `--type <one of 9>`; `--contract '<json>'`; `--rel-kind <text>` |
| `graph update-status` | Transition (state machine + ready gate + max_attempts + passed hard gate) | `-i <id>` `-s <status>`; `--claim-by <agent>`; `--force` human-ops only |
| `graph reclaim` | Reclaim a dead claim: running → pending | `-i <id>`; `--by <actor>` |
| `graph update-node` | Update node details | `-i <id>` `--plan-desc` `--add-dod`(repeatable) `--clear-dod` `--add-checkpoint '<JSON>'`(repeatable) `--set-assigned` `--label` `--max-attempts` `--set-priority` `--set-context` `--boundary` `--glossary-add '<JSON>'`(repeatable) `--reset-attempts` `--show` |
| `graph update-graph` | Edit entry/exit/criteria/label (never hand-edit graph.yaml) | `--entry-desc` `--exit-desc` `--add-criteria`(repeatable) `--clear-criteria` `--label` `--set-context '<json>'` |
| `graph adr` | ADR lifecycle group (v0.5): create lands as proposed; accept/supersede belong to the adjudicator | `create -t <title> -d <decision>`; `accept -i <id>`; `supersede -i <id> --by <id>`; `list [-s <status>]` |
| `graph delete-node` | Soft-delete a node; refuses when referenced | `-i <id>`; `--cascade` |
| `graph delete-edge` | Soft-delete an edge | `-i <id>` |
| `graph status` | Status overview + topology check | `--json` |
| `graph validate` | Schema + references + topology + cycles (per-file locations) | `--json` |
| `graph next` | Scheduling: claimable / ready-eligible / blocked / running / stale | `--stale-ms <ms>`; `--json` |
| `graph verdict` | Record an adjudication verdict | `-i <id>` `--verdict passed\|failed\|pending` `--note <text>` |
| `graph snapshot` | Create a version snapshot | `-m <msg>`; `--git` also commits |
| `graph snapshots` | List snapshots | `--json` |
| `graph diff` | Diff (default: latest snapshot vs working tree) | `--from <id>` `--to <id>`; `--json` |
| `graph rollback` | Rollback (auto-backup first) | `<snapshot-id>` `--confirm`; `--design-only` |
| `graph events` | Read the audit event log | `--node <id>` `--kind <k>` `--last <n>`; `--json` |
| `graph rebuild` | Rebuild `index/` derived artifacts (graph.json + topology.dot) | — |
| `graph export` | Mermaid export (knowledge-vertex shapes/colors + edge styles, entry/exit + legend in header); `--docs` regenerates domain doc views | `--mermaid -o <file>`; `--docs` (`--adr-dir`/`--ctx-dir` optional) |
| `graph serve` | Start the Web UI (auto-opens browser) | `-p <port>` (default 8934); `--no-open` |

> Unsure about flags? Every command has `--help`: `graph create-node --help`.

### Command aliases

Common commands have 1–2 character aliases (fully equivalent):

| Command | Alias | Command | Alias |
|---------|-------|---------|-------|
| `graph init` | `graph i` | `graph update-node` | `graph un` |
| `graph create-node` | `graph cn` | `graph delete-node` | `graph dn` |
| `graph get-node` | `graph gn` | `graph delete-edge` | `graph de` |
| `graph add-edge` | `graph ae` | `graph update-graph` | `graph ug` |
| `graph update-status` | `graph us` | `graph next` | `graph n` |
| `graph verdict` | `graph vd` | `graph diff` | `graph d` |
| `graph snapshot` | `graph sp` | `graph snapshots` | `graph sps` |
| `graph rollback` | `graph rol` | `graph status` | `graph s` |
| `graph validate` | `graph v` | `graph export --mermaid` | `graph x --mermaid` |
| `graph rebuild` | `graph rb` | `graph serve` | `graph sv` |
| `graph reclaim` | `graph rc` | `graph switch` | `graph sw` |
| `graph list` | `graph ls` | `graph rename-graph` | `graph rg` |
| `graph delete-graph` | `graph dg` | | |

E.g. `graph cn -i t1 -l "Task 1"` ≡ `graph create-node -i t1 -l "Task 1"`.

---

## State machine (7 states + three hard rules)

```text
pending ──► ready ──► running ──► passed ──► blocked
                     │   │
                     │   └──► failed ──► pending   (retry, attempts accumulate)
                     ▼
              cancelled (terminal)
        blocked ──► ready / failed / cancelled
```

- **Claim**: `ready → running` records `assigned_to` + `started_at` (MCP: `claim_by`)
- **Completion**: `passed` / `failed` record `completed_at` automatically
- **Passed hard gate**: missing execution report / unaggregated checkpoints / failed verdict → `running → passed` rejected at the core layer (`--force` is human-ops only)
- **Reclaim**: `graph reclaim` returns a dead `running` claim to `pending` (recovery when an executor crashed); `cancelled` can reopen to `pending`
- **Protection**: illegal transitions (e.g. `pending → running`) return explicit errors — **never silent**

---

## MCP: let AI agents do the work 🤖

Super Plumber ships an MCP server (stdio transport). Coding agents can read the graph, create nodes, claim tasks, and report progress like any other tool.

### Start

```bash
graph-mcp
```

### Client configuration (set up once, works in every project)

**Recommended: global install + global config — no paths / `--root` needed.**
The server locates the current project's graph on every tool call (resolution chain below). Switching projects or sessions requires no config changes.

```bash
npm install -g @lukawi/super-plumber
```

**Claude Code** (`claude.json`):

```json
{
  "mcpServers": {
    "super-plumber": {
      "command": "graph-mcp"
    }
  }
}
```

**opencode** (`~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "super-plumber": {
      "type": "local",
      "command": ["graph-mcp"],
      "enabled": true
    }
  }
}
```

**Generic npx form** (no global install; any MCP client):

```json
{
  "mcpServers": {
    "super-plumber": {
      "command": "npx",
      "args": ["-y", "-p", "@lukawi/super-plumber", "graph-mcp"]
    }
  }
}
```

> Since v0.4.1 a global install also registers a `super-plumber` command (also starts the MCP server), so npx can be shortened to `npx -y @lukawi/super-plumber`.

**Graph directory resolution** (evaluated per tool call, highest first):

1. `--root <dir>` startup flag / `SUPER_PLUMBER_ROOT` env — only when you want to pin the server to one graph;
2. **MCP workspace roots**: the first client-reported project root containing `.graph/`;
3. Walk up from the server process cwd looking for `.graph/` (works from project subdirectories);
4. Otherwise → readable error ("graph directory not initialized… run graph init or pass --root") — **never silently returns an empty graph**.

> Inside a workspace, the current graph resolves along the chain (v0.5.2): `SUPER_PLUMBER_GRAPH` env > in-process active (`graph_switch`, MCP only) > `.graph/active` workspace default > `default` fallback. MCP switches graphs in-process via `graph_switch` without rewriting the workspace default (CLI data commands take a leading `--graph` flag instead).
>
> Only a pinned single-graph setup needs explicit config: `"command": "graph-mcp", "args": ["--root", "/path/to/graph"]`.

### The 24 tools

**Scheduling**: `graph_get_next_actions` — claimable (ready) / **ready-eligible (pending|failed whose gates are satisfied — cold-start entry)** / blocked (with unmet predecessors) / running (with elapsed) / stale_running, per-bucket pagination (`limit` + `truncated`), entries may carry `adr_flags` (stale decision basis ⚠️). The agent planning loop's first call.

**Multi-graph (v0.5.2)**: `graph_switch` (in-process switch: with name → switch + summary; without → current info; restarts fall back to the workspace default), `graph_list_graphs` (list all with is_current / inspect one); **every tool response echoes the graph name**; cross-graph smart errors (a missing id that exists in graph X → error says "it lives in graph X, graph_switch first" — never auto-switches).

**Reads**: `graph_get_node` (node + legal transitions + checkpoint aggregation + gate status + **governing_adrs pointers** + optional topology neighbors), `graph_get_graph` (summary mode by default; `mode=full` + `offset/limit` pages), `graph_traverse` (`max_nodes` cap), `graph_search` (`limit` + compact results, supports `type: adr/context`).

**Design-time writes**: `graph_create_node` (full package: plan/DoD/checkpoints in one call; supports `type=context/adr` and `context` membership), `graph_create_adr` (**v0.5**: auto-numbered adr_NNNN, lands as proposed — propose/adjudicate separation), `graph_batch_create` (batch nodes+edges with whole-batch pre-validation), `graph_add_edge` (incl. `decides`/`relates` knowledge edges with `contract`/`rel_kind`), `graph_update_node` (domain fields `set_context`/`boundary`/`glossary_add`/`superseded_by`), `graph_update_graph` (entry/exit/criteria), `graph_delete_node` (refuses when referenced; `cascade`), `graph_delete_edge`.

**Execution-time writes**: `graph_update_node_status` (`status=running` with `claim_by` performs an **atomic claim** — concurrent losers fail cleanly — and the response carries **governing_adrs pointers**; **force is protocol-level rejected on MCP** — humans use CLI `--force` with a force_override audit event; the ADR three-state machine flows through this tool, supersede = set `superseded_by` via `graph_update_node` first, then the status), `graph_update_checkpoint` (checkpoint state machine, idempotent), `graph_update_execution_report` (handoff + `verification` verdict), `graph_reclaim_node` (dead-claim reclamation: running → pending). `graph_update_node` requires explicit `reset_attempts: true` (editing the plan never implicitly resets attempts; resets are audited).

**Versioning**: `graph_snapshot` / `graph_diff` / `graph_rollback` (`confirm: true` required; `design_only: true` rewinds design while keeping execution progress).

**Self-check & audit (v0.6.0)**: `graph_validate` (cycles/ghost edges/schema/six domain rules/reference-list drift, structured ok/errors/warnings — the self-check after batch creation or crash recovery), `graph_events` (event-log replay with `node`/`kind` filters + `last` tail — trace claims/force_override/attempts_reset).

**Reliability**: every parameter is zod-validated — missing/invalid params return `-32602` protocol errors; unknown nodes/edges return `isError=true` with readable messages; illegal transitions/gates/attempt caps/passed hard gate fail loudly. **Tools never fail silently.**

---

## Web UI (starfield observatory, Svelte 5 + D3.js)

```bash
graph serve
# auto-opens http://localhost:8934; use `graph serve --no-open` on CI/headless
```

A **starfield** pinned to the developer's screen: every task is an eight-point star, status colors breathe along the rays, domains glow as nebulae, and a galaxy band stretches across the background. The chrome is frosted instrument glass floating above — the v0.7.0 "Deep-Space Instrument Bay" design.

- **Starfield canvas**: V4 prism stars (white-hot rays + chromatic ghosting) + status halos along the rays + id-hashed twinkle phases; `running` nodes breathe and feed amber energy flows along outgoing edges; edges fade into the star glow at both ends; contract edges dashed; the galaxy band and dust form a fixed-screen atmosphere layer
- **Map lenses**: pick **workflow / domain** maps in any subset from the dock — overlay view (stars + per-context nebulae + dashed contract edges), domain-only view (stars + nebulae, no edges); nebula colors always ship with the bottom-left **cluster legend**
- **Single-row console bar**: brand + status filters (counts are the legend; click to filter) + levels + search + n/e stats on one line that never stacks; **counts match what you see** (only workflow stars and renderable edges are counted)
- **Floating glass dock**: graph library (switch-graph popover) / decision docs (ADR catalog popover: three-state dots, superseded strikethrough + successor chain) / map lenses / diff / zoom ×3 / pin layout / focus mode; Tab cycles within the dock
- **Unified detail drawer**: click a star, an edge, a context core, or an ADR catalog entry — the same glass drawer rises on the right: node (plan / DoD / checkpoints / execution report, all Markdown-rendered), context (boundary / glossary / members — node as document), decision doc (decision / background / options / rationale / consequences + governed-targets jumping + successor chain), edge (semantics / endpoints / contract); **panels are mutually exclusive**, Esc exits layer by layer
- **Version diff**: open the snapshot list from the dock → selecting a snapshot shape-encodes added/removed/modified on the canvas (bold solid / dashed / dash-dot — never hijacking status colors) + a top diff badge + per-file/per-status details
- **Focus mode**: all chrome exits; pure black starfield + breathing `running` + energy flows — the wall-mount form; a persistent exit pill bottom-right (Esc works too)
- **Fully keyboard-accessible**: stars/cores/dock each cycle within their own group via Tab, Enter/Space selects, Esc exits panel→diff→focus→popovers in order, search Enter locates, `0` fits the view; visible focus rings throughout
- **Read-only + live**: the seven status colors are the canvas's only chromatic semantics; the UI sends zero write commands (adjudication stays on the CLI/MCP human channel); WebSocket delta push + exponential-backoff auto-reconnect
- **Accessibility**: body text ≥ AA contrast; `prefers-reduced-motion` disables every animation end to end

---

## Storage layout (Git-friendly, human-readable)

```text
.graph/                    # workspace directory (created by graph init)
├── active                 # workspace default graph name (written by graph switch)
├── schema.yaml            # human-readable schema description (runtime validation in core/schema.ts)
├── workspace-events.jsonl # workspace-level audit (init/switch/migrate/rename/delete)
├── <graph>/               # one directory per graph (v0.5.2; per-graph locks/index/events/snapshots)
│   ├── graph.yaml         # graph definition: entry/exit/root context + node/edge reference lists
│   ├── nodes/*.yaml       # node files: plan / checkpoints / expected_outcome / execution_report
│   ├── edges/*.yaml       # edge files: source / target / type / contract
│   ├── snapshots/<id>/    # version snapshots: manifest + full file copies (graph snapshot)
│   ├── events.jsonl       # per-graph append-only event log (read by graph events)
│   └── index/             # derived index (graph.json / meta.json / topology.dot — deletable, rebuildable)
└── .trash/                # delete-graph soft-delete recycle bin (manually recoverable)
```

> Legacy repos are zero-migration compatible: `.graph/graph.yaml` at the root is recognized in place as the `default` graph; creating a second graph migrates it into `.graph/default/` once, under the workspace lock.

**Design principles:**

- **Git is the single source of truth** — everything is a file: diffable, revertible, reviewable
  > ⚠️ If you treat Git as the source of truth (delete `.graph/`, restore via `git clone`), do **not** gitignore `.graph/`; this repo ignores it only because its runtime graphs aren't committed during development
- **File per node** — one YAML per node; edit directly in your editor
- **Structure over prose** — YAML schema constraints refuse the ambiguity of free-form Markdown
- **Pure filesystem** — no database; soft deletes keep `.deleted.yaml` history

> The repo ships an example topology `.graph-example/` (20 nodes, 36 edges + `setup-topology.sh`) if you want reference material.

---

## Pi agent ecosystem: subagents + skills

The project ships 3 dedicated subagents (`.pi/agents/`) and 6 skills: plumber-design, plumber-execute, plumber-join, sp-grilling, plumber-tdd, and plumber-review.

| Agent | Role | Responsibility |
|-------|------|----------------|
| `sp-designer` | Topology designer | Decompose requirements into a structured topology; write plan and definition_of_done per node |
| `sp-executor` | Execution worker | Follow plumber-execute through checkpoint/report; leave verdicts to the adjudicator |
| `super-mario` | Topology adjudicator | Node lifecycle adjudication (checkpoint aggregation + output spot-checks), retry management, health monitoring |

**Two-stage skill protocol**: `plumber-design` owns the **design phase** (requirements → graph → `graph validate` + doctor script → `graph serve` preview → user review, which is a hard gate); once approved, `plumber-execute` owns the **execution phase** (claim → checkpoint-by-checkpoint reporting → execution_report → passed; fan_out/fan_in structure + conditional judgment decide when to fan out subagents; after all task nodes pass, a three-layer acceptance: states all green + structure validate 0 errors + deliverables checked against exit criteria). Supporting scripts: `sp-check-design.mjs` (design doctor) on the design side; one `sp.mjs` entry point (read/status/claim/checkpoint/report/traverse subcommands) on the execute side.

---

## Multi-tool integration (v0.6.1)

The same workflow assets (role prompts / staged skills / execution scripts / Operations manual) ship in several integration forms — pick per your agent tool:

| Integration | How |
|-------------|-----|
| **pi** (repo-native) | Use the repo-root `.pi/` directly; to bring it elsewhere, copy the `.pi/` directory to that project root |
| **Claude Code** (plugin `super-plumber`) | `/plugin marketplace add lukawi/super-plumber`, then install `super-plumber`; for local preview run `claude plugin marketplace add ./` at the repo root |
| **ZCode** (same plugin) | Settings → Plugin management → Discover → add marketplace `lukawi/super-plumber` (or a local directory), then install `super-plumber` |
| **Codex** (official plugin, v0.9.6) | `codex plugin marketplace add lukawi/super-plumber`, then install `super-plumber`; for a local checkout run `codex plugin marketplace add .` at the repo root |

> Claude Code, ZCode, and Codex reuse **the same plugin package** (`integrations/plugin/`). Claude/ZCode use the `.claude-plugin` manifest, while Codex uses the package's `.codex-plugin/plugin.json`; skills, scripts, and the manual are shared, with host-specific registration and MCP configuration.

### Codex plugin (v0.9.6)

The repo-level Codex marketplace is `.agents/plugins/marketplace.json`. Install from GitHub:

```bash
codex plugin marketplace add lukawi/super-plumber
codex plugin add super-plumber --marketplace lukawi-super-plumber
```

For a local checkout, run `codex plugin marketplace add .`, inspect it with `codex plugin list --marketplace lukawi-super-plumber --available`, and then install it. Start a new session after installation so the cached skills and MCP configuration are loaded.

Claude/Codex compatibility notes:

- Both read `integrations/plugin/skills/` and the plugin-root `manual.md`. The Codex manifest carries an inline `mcpServers.graph-mcp` entry (`command` + `args`); Claude keeps the existing `.mcp.json` with its `mcpServers` key, so Claude/ZCode configuration is unchanged.
- Claude's four slash commands and automatic `agents/*.md` discovery are not Codex plugin components. Codex therefore defaults to the six skills' solo branch for design, execution, and adjudication.
- If an independent designer/adjudicator is useful, add the optional project-level `.codex/agents/sp-designer.toml` and `.codex/agents/super-mario.toml`. These are host-project enhancements, not entries installed into the plugin cache, and they do not change the solo default.
- This project's hooks harness is also unregistered and off by default for Claude/ZCode; Codex does not inherit Claude hook/settings registration. Enable it through each host's own configuration format rather than copying Claude snippets into the Codex manifest.
- If a Windows host cannot resolve `npx` directly, use this `config.toml` fallback:

  ```toml
  [mcp_servers.super-plumber]
  command = "cmd"
  args = ["/c", "npx", "-y", "@lukawi/super-plumber", "graph-mcp"]
  ```

  The plugin manifest uses the same `npx -y @lukawi/super-plumber graph-mcp` command as Claude's `.mcp.json`; the wrapper is only a Windows fallback.

After installing you get:

- **Claude/ZCode's 4 slash commands**: `/plumber-design` — design-phase orchestration (requirements → graph → validate/doctor double-green → browser preview → user review); `/plumber-execute` — execution-phase orchestration (claim → checkpoint reporting → handoff → three-layer acceptance); `/plumber-join` (v0.8.2) — minimal-context entry ending at ready, then hand off to plumber-execute; `/plumber-class` (v0.9.1) — work-class credentials. pi has no slash commands; the `.pi/skills/` staged skills drive the same flows directly.
- **Codex's 6 skills + graph-mcp**: `plumber-design`, `plumber-execute`, `plumber-join`, `sp-grilling`, `plumber-tdd`, and `plumber-review`; Codex does not consume Claude slash-command registration or plugin `agents/*.md` files.
- **Claude/ZCode's 3 subagents**: `sp-designer`, `sp-executor`, and `super-mario`, dispatched by the skills' templates; a solo branch kicks in when no subagent facility exists. Codex's same-named TOML files are optional project-level enhancements (see above).
- **sp-grilling** is user-invoked only, never automatically called by an agent or required for design review. Design remains a complete workflow without sp-designer.
- **Operations manual**: the single source of truth for command syntax. pi users read `integrations/shared/manual.md` at the repo root; plugin users read `manual.md` inside the plugin package (a build-time-synced copy).

### Solo mode (single person, single session)

When the main thread plays both designer and executor, the adjudication boundary is a written rule (manual §10): **mechanical checks may self-adjudicate** — checkpoint aggregation, artifact existence, state/structure acceptance, with evidence in notes; **judgment calls must stop for a human** — subjective DoD quality, ADR accept/supersede, user review gates, force actions.

### npm fallback (when marketplaces are unreachable)

The npm package ships the integration assets (`files` includes `integrations/`, `.pi/`, and `.agents/`). After installing, point Claude Code / ZCode at `node_modules/@lukawi/super-plumber/integrations/plugin/`; for Codex, register the installed package root as a local marketplace: `codex plugin marketplace add ./node_modules/@lukawi/super-plumber`. You can also copy `.pi/` to your project root — no GitHub access required.

### ZCode without the plugin

Alternatively, skip the plugin and copy the agent definition markdown files into `~/.zcode/agents/` (user level) — ZCode discovers them. At project level `<repo>/.zcode/agents/`, the `permissionMode` frontmatter field is stripped (permission fields only take effect at user level), and reserved names `general-purpose` / `Explore` cannot be used.

---

## Development & testing

```bash
# Build from source
git clone https://github.com/LUKAWI/super-plumber
cd super-plumber
npm install
npm run build && npm --prefix web-ui run build

# Tests (858 backend + 117 frontend: state machine/topology/CLI/MCP protocol/multi-graph migration & perf/concurrency hardening/escaping/render smoke)
npm test

# Link globally for development
npm link
graph --version
```

---

## FAQ

| Problem | Cause & fix |
|---------|-------------|
| `❌ 未找到图…请先运行 graph init <内容名>` | No graph in the current directory. Run `graph init <name>` or `cd` into the graph directory |
| MCP reports "graph directory not initialized…" | The server didn't locate your project: run `graph init <name>` in the project; if the client supports workspace roots it follows automatically, otherwise restart the client from the project directory or set `SUPER_PLUMBER_ROOT` |
| **MCP tools still behave like the old version after upgrading** | A connected MCP server keeps old code in memory. **Restart the MCP server** (reconnect the client or restart it after `npm i -g @lukawi/super-plumber`) — upgrades never hot-swap a running process |
| `❌ 端口 8934 已被占用` | A serve is already running. Use `graph serve -p 8935` |
| `❌ Node x already exists` / `Edge x already exists` | Duplicate id. Tools refuse to overwrite; pick a new id |
| `❌ Invalid transition: ...` | Skipped the allowed path. Follow the `Allowed: [...]` hint |
| `❌ MCP error -32602: ...` | Missing params or invalid enum on an MCP call; fix per the message |
| `❌ 节点不存在: x` | Node doesn't exist (soft-deleted or typo) — confirm with `graph status` / `graph_search` |
| `❌ Node x 前置未满足…` | Ready gate (predecessors not all passed). Finish predecessors first; don't use `--force` (human-ops only) |
| `❌ force 仅人类运维通道…` | By design: agents cannot override. Humans use CLI `graph update-status --force` (audited as force_override) |
| `❌ Node x already claimed by y` | Lost a concurrent claim race (atomic protection). Pick another ready node |
| `❌ Node x 已达最大重试次数` | Attempts exhausted. Intervene manually or `graph update-node --reset-attempts` (audited) |
| `❌ Node x 无执行报告，不能标记 passed` | Passed hard gate: file the handoff report first (MCP `graph_update_execution_report` or `sp.mjs report`, non-empty summary); unaggregated checkpoints or a failed verdict also block |
| `❌ Node x 被 N 条边引用` | Deleting would leave dangling references. Use `--cascade` or delete edges first |
| `❌ 节点长时间 running 无进展` | Dead claim: `graph reclaim -i <id>` returns it to pending (executor crashed) |
| `❌ schema 校验失败: ...` | Hand-edited YAML typo. `graph validate` locates it per file |
| Global command unchanged after code edits | The global install is a published snapshot. `npm version patch && npm publish && npm i -g @lukawi/super-plumber` |
| Blank graph after `graph serve` | Check the cwd contains the graph; the UI shows empty-state guidance |
| UI stopped updating | Auto-reconnect since v0.2 (exponential backoff + HTTP fallback); if the server exited, run `graph serve` again |

---

## Project status

```text
Tests: 858 (backend) + 117 (frontend) ✅ | CLI: 29 commands | MCP: 26 tools | Slash commands: 4 | State machine: 7 states + ready gate + max_attempts + passed hard gate + audit event log + ADR 3-state machine (knowledge vertices exempt) + design review credentials (v0.8.0) + delete-refusal reason credentials & DECISIONS.md decision index (v0.8.1) + human-machine division in scheduling: requires_human derivation / waiting-for-human flag / human stale 4h + class credentials /plumber-class & class_changed events (v0.9.1) | Edge types: 9 | Versioning: snapshot/diff/rollback (incl. design-only) | Web UI: Svelte 5 + D3.js starfield observatory (v0.7.0 Deep-Space Instrument Bay + v0.8.1 frontier one-click views / phase legend / Avoid annotations)
```

- **npm**: [@lukawi/super-plumber](https://www.npmjs.com/package/@lukawi/super-plumber)
- **GitHub**: [LUKAWI/super-plumber](https://github.com/LUKAWI/super-plumber)
- **Architecture decisions**: `docs/adr/` (topological sort ignores runtime edges / file-first storage)
- **Domain glossary**: `CONTEXT.md`

## License

MIT © 2026 Super Plumber contributors
