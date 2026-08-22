# Super Plumber 🚰 — AI Agent Workflow Topology Graph Manager

> Turn "task documents" into **graphs agents can natively understand**: nodes are tasks, edges are dependencies, a state machine owns the lifecycle.
> One install, three access layers (CLI / MCP / Web UI), pure YAML file storage (no database, no server).

[![npm version](https://img.shields.io/npm/v/@lukawi/super-plumber)](https://www.npmjs.com/package/@lukawi/super-plumber)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-316%2F316-green)](https://github.com/LUKAWI/super-plumber/actions)
[![GitHub](https://img.shields.io/badge/GitHub-LUKAWI%2Fsuper--plumber-black)](https://github.com/LUKAWI/super-plumber)

**中文版:** [README.md](README.md) · **npm:** [@lukawi/super-plumber](https://www.npmjs.com/package/@lukawi/super-plumber)

---

## Why Super Plumber?

A Todo list is just lines of text — no ordering, no acceptance criteria, no lifecycle. Hand that to an AI agent and it has to guess what you meant.

Super Plumber restructures your workflow as a **graph**:

```text
todo: "build a registration module"  →   entry → l1_register → l1_login → exit
                                          ↳ each node = plan + checkpoints + definition of done
                                          ↳ each edge = typed dependency (who comes first, who validates whom)
                                          ↳ each state = enforced by a state machine (no skipping steps)
```

- **For humans**: a structure you can read at a glance, a live Web UI, plain-text files you can commit to Git.
- **For AI agents**: read the graph, claim tasks, and report progress over MCP — every node is a "tarball" (plan + checkpoints + handoff report). No guessing.

---

## Feature Highlights

| Capability | Description |
|------------|-------------|
| 🧭 **Typed topology** | 9 edge types: `depends_on` / `validates` participate in topological sort; `shares_context` / `fan_out` / `fan_in` / `fallback` / `iterates` express runtime control flow; `decides` / `relates` (v0.5) carry domain knowledge |
| 🏛️ **Domain semantics (v0.5)** | **Bounded contexts and ADRs are first-class graph citizens**: context vertices follow "node as document" (boundary + glossary); node membership (`--context`) derives workflow/domain maps; **ADR state machine** proposed→accepted→superseded (supersede requires a successor; propose/adjudicate separation); `graph adr` command group + MCP `graph_create_adr`; decision changes propagate along decides edges (claim responses inject `governing_adrs` pointers, scheduling entries get `adr_flags` ⚠️); cross-context workflow edges are contract edges (contract required); `graph export --docs` regenerates docs/adr + CONTEXT-MAP.md + per-context CONTEXT.md (graph is the source of truth, markdown is a view) |
| 🔄 **Enforced state machine** | 7 states + three hard rules: ready gate (gating predecessors must be `passed`), max_attempts cap, and a **passed hard gate** (no execution report / unaggregated checkpoints / failed verdict → `passed` rejected); concurrent claims are atomic under a lock; knowledge vertices are exempt (context is stateless, ADR has its own 3-state machine) |
| 🤖 **Native MCP** | 20 `graph_*` tools covering the whole flow: design (batch create / add edge / edit entry-exit / **graph_create_adr**), execution (atomic claim with governing-ADR pointers / checkpoint / report / **reclaim of dead claims**), adjudication (verdict), versioning (snapshot/diff/rollback) — all with zod-validated params |
| 🎯 **Scheduling decisions** | `graph next` / `graph_get_next_actions` returns claimable / ready-eligible (cold-start entry) / waiting-on-deps / running / possibly-stale in one screen, with per-bucket pagination + truncated flags; ready buckets ordered by node `priority`; staleness = last activity (reporting acts as a heartbeat); entries may carry `adr_flags` (stale decision basis ⚠️); knowledge vertices never enter scheduling buckets — the agent planning loop's first call |
| 🗂️ **Versioning** | `snapshot` / `diff` / `rollback` primitives (auto-backup before rollback, explicit confirm required; **design-only rollback** rewinds design fields while keeping execution progress); Branch/Merge stays with Git |
| 🧾 **Event log** | `.graph/events.jsonl` append-only audit: who created/deleted/transitioned/claimed/overrode/reset/rolled back what and when, including the ADR lifecycle (adr_created/accepted/superseded) — `graph events` for one-command traceability |
| 📉 **Context economy** | All MCP read endpoints paginate: `graph_get_graph` defaults to summary mode (compact fields) + paginated full mode, `graph_search` limit, `graph_traverse` max_nodes, `graph_get_node` optional topology neighbors — no more token explosions on large graphs; ADRs are injected as title-level pointers only, never full-text |
| ⚡ **Large-graph hot paths** | Two-level index cache (in-memory + on-disk graph.json): gate/scheduling drop from full-graph scans (~9s @10k) to table lookup + single-file reads; scheduling is O(N+M); **write paths actively invalidate the cache** (no betting on filesystem mtimes — long-running processes read-after-write consistent) |
| 🌐 **Web visualization** | Force-directed graph, per-edge-type colors, flow dots on `running` nodes, checkpoint progress bars, WebSocket delta push; **v0.5 map lenses**: checkbox workflow/domain maps in any subset — domain view (contexts + relates + glossary detail), overlay view (cluster hulls wrapping members, ADR badges, contract-edge highlighting); the UI stays strictly read-only |
| 📁 **File-first storage** | One YAML file per node/edge, Git as the single source of truth, human-editable, no database |
| 🧩 **Agent collaboration protocol** | Built-in `plumber-design` (topology design + domain modeling + ADR triage + preview review gate) and `plumber-execute` (topology execution + 3-layer acceptance + governing-ADR discipline) skills + 2 dedicated subagents (designer / adjudicator) |

---

## Installation (step by step)

### Prerequisites

| Requirement | Version | How to check |
|-------------|---------|--------------|
| Node.js | **≥ 20** (includes npm) | `node --version` |
| Platform | Windows / macOS / Linux | — |

> No Node.js yet? Download the LTS installer from [nodejs.org](https://nodejs.org) and click through the defaults.

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
graph --version     # prints 0.5.0 on success
graph --help        # lists all 22 commands
which graph         # confirm location (Windows: where graph)
```

### 3. Try it in a fresh directory

```bash
mkdir ~/my-first-graph && cd ~/my-first-graph
graph init -l "My first topology"
```

You should see `✅ 已初始化 .graph/ 目录`. A `.graph/` folder now exists in the directory — that's your graph.

---

## Quick Start (a graph in 2 minutes)

```bash
# 1. Initialize
graph init -l "User Registration"

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
graph init -l "User Registration"
```

Every graph has exactly one **entry** (the requirement) and one **exit** (the acceptance criteria), both at level 0. The CLI has no dedicated entry/exit command yet — edit `.graph/graph.yaml` in your editor:

```yaml
entry:
  description: "Build a user registration module: email+password signup and login"
  defined_by: human
  level: 0
exit:
  description: "Working registration/login, all tests pass"
  acceptance_criteria:
    - "Register API works"
    - "Login keeps a session"
  defined_by: human
  level: 0
```

> `graph validate` warns when entry/exit are empty — a hint, not an error. Fill them in and the warning goes away.

### Step 2 — Create nodes (each node is a "tarball")

A node = **id + label + plan + checkpoints + definition_of_done**:

```bash
# Top-level node with plan, acceptance criteria and assignee
graph create-node -i l1_register -l "Registration" -t task --level 1 \
  --plan-desc "Email+password registration: endpoint, validation, storage" \
  --dod "Register API returns 200" --dod "Passwords bcrypt-hashed" --dod "Duplicate email rejected" \
  --assigned-to "backend-agent"

# Child node, decomposed to executable granularity
graph create-node -i l2_reg_api -l "Register endpoint" -t task --level 2 \
  --plan-desc "POST /register endpoint" --dod "Endpoint tests pass"

graph create-node -i l2_reg_store -l "User storage" -t task --level 2 \
  --plan-desc "Users table + password hashing" --dod "Storage tests pass"
```

Add **checkpoints** (sub-steps the executor reports as it finishes each one):

```bash
graph update-node -i l1_register \
  --add-checkpoint '{"id":"cp1","label":"Endpoint dev"}' \
  --add-checkpoint '{"id":"cp2","label":"Password hashing"}' \
  --add-checkpoint '{"id":"cp3","label":"Integration test"}'

# Inspect the full node
graph update-node -i l1_register --show
```

### Step 3 — Connect edges (any of 7 types)

```bash
graph add-edge -i e1 -s l1_register -t l1_login --type depends_on
graph add-edge -i e2 -s l2_reg_api -t l2_reg_store --type depends_on
graph add-edge -i e3 -s l2_reg_api -t l1_register --type validates   # validation relationship
graph add-edge -i e4 -s l1_register -t l1_login --type shares_context # shared context
```

| Edge type | Meaning | Participates in topo sort |
|-----------|---------|:---:|
| `depends_on` | Sequential dependency: B needs A done | ✅ |
| `validates` | A's output is validated by B | ✅ |
| `shares_context` | A's output feeds B as input context | ❌ |
| `fan_out` | After A, multiple downstreams may run in parallel | ❌ |
| `fan_in` | C runs only after all upstreams finish | ❌ |
| `fallback` | On B's failure, retry via A | ❌ |
| `iterates` | A ⇄ B iterate until satisfactory | ❌ |

> `depends_on` / `validates` feed the topological sort; runtime edges are ignored for sorting (e.g. `fallback`'s backward reference won't be misreported as a cycle).

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
📊 校验结果: 0 错误, 0 警告
```

> **Try creating a cycle on purpose**: `graph add-edge -i e_cycle -s l1_login -t l1_register --type depends_on`
> validate reports `检测到循环依赖: l1_register → l1_login → l1_register` — the tool won't let you ship a graph with a cycle.

### Step 5 — Execute (state-machine driven, claimed by a human or an agent)

```bash
# State machine: pending → ready → running → passed
graph update-status -i l1_register -s ready      # deps done, ready to run
graph update-status -i l1_register -s running    # claim: records start time (record the executor via MCP `claim_by`)
graph update-status -i l1_register -s passed     # done

# Try an illegal jump — the state machine stops you:
graph update-status -i l1_login -s running
# ❌ Invalid transition: pending → running. Allowed: [ready, cancelled]
```

> Full machine: `pending → ready → running → passed → blocked`, `running → failed → pending` (retry, `attempts` auto-increments), any state → `cancelled`.

**Reporting checkpoints and the handoff** (CLI has no such commands — use the MCP tools or the skill scripts):

Option 1 · MCP tools (requires an agent wired up, see the MCP section below):

```json
// graph_update_checkpoint: { node_id: "l1_register", checkpoint_id: "cp1", status: "passed" }
// graph_update_execution_report: { node_id: "l1_register", summary: "Registration done", artifacts: ["dist/register.js"] }
```

Option 2 · skill scripts (shipped with the `plumber-execute` skill — for pi users at `~/.pi/agent/skills/plumber-execute/scripts/`, or project-local `.pi/skills/plumber-execute/scripts/`):

```bash
SCRIPTS=~/.pi/agent/skills/plumber-execute/scripts

# Claim a ready node (records claim_by + started_at; non-ready nodes are rejected by the state machine)
node $SCRIPTS/sp-claim.mjs l1_register backend-agent

# Report each checkpoint as you finish it (finished-but-unreported progress is lost)
node $SCRIPTS/sp-checkpoint.mjs l1_register cp1 passed

# Submit the handoff (summary + artifacts + blockers + notes)
node $SCRIPTS/sp-report.mjs l1_register "Registration done" "dist/register.js,test/register.test.js" "" "bcrypt for passwords"
```

### Step 6 — Visualize and share

```bash
graph export --mermaid -o flow.mmd    # export a Mermaid flow diagram
graph serve                           # open http://localhost:8934 for the force-directed view
```

---

## CLI Reference (22 commands)

| Command | Purpose | Key flags |
|---------|---------|-----------|
| `graph init` | Initialize the `.graph/` skeleton | `-l <label>`; `--force` to reset an initialized graph |
| `graph create-node` | Create a node | `-i <id>` `-l <label>` `-t <type>` (task/checkpoint/decision/gate) `--level <n>` `--plan-desc <text>` `--dod <item>` (repeatable) `--assigned-to <agent>` |
| `graph add-edge` | Add a typed edge | `-i <id>` `-s <source>` `-t <target>` `--type <one of 7>` |
| `graph update-status` | State transition (state machine validated) | `-i <id>` `-s <status>` (pending/ready/running/passed/failed/blocked/cancelled) |
| `graph update-node` | Update node details | `-i <id>` `--plan-desc` `--add-dod <item>` (repeatable) `--clear-dod` `--add-checkpoint '<JSON>'` (repeatable) `--set-assigned <agent>` `--show` |
| `graph delete-node` | Soft-delete a node | `-i <id>` (keeps `.deleted.yaml` history) |
| `graph status` | Status overview + topo check | — |
| `graph validate` | Integrity check (references + topo sort + cycles) | — |
| `graph rebuild` | Rebuild `index/` derived indexes | — |
| `graph rollback` | Rollback to a snapshot (auto-backup first) | `<snapshot-id>` `--confirm` (required); `--design-only` keeps execution progress |
| `graph events` | Read the append-only event log (audit trail) | `--node <id>` `--kind <k>` `--last <n>`; `--json` |
| `graph export --mermaid` | Export a Mermaid diagram | `-o <file>` |
| `graph serve` | Start the Web UI (auto-opens browser) | `-p <port>` (default 8934); `--no-open` to skip |

> Not sure about flags? Every command has `--help`: `graph create-node --help`.

### Shortcuts (aliases)

Common commands accept 1-2 character aliases; full names still work (equivalent):

| Full command | Alias | Full command | Alias |
|--------------|-------|--------------|-------|
| `graph init` | `graph i` | `graph update-node` | `graph un` |
| `graph create-node` | `graph cn` | `graph delete-node` | `graph dn` |
| `graph add-edge` | `graph ae` | `graph status` | `graph s` |
| `graph update-status` | `graph us` | `graph validate` | `graph v` |
| `graph rebuild` | `graph rb` | `graph export --mermaid` | `graph x --mermaid` |
| `graph serve` | `graph sv` | | |

E.g. `graph cn -i t1 -l "Task 1"` ≡ `graph create-node -i t1 -l "Task 1"`.

---

## State Machine (7 states, 14 transitions)

```text
pending ──► ready ──► running ──► passed ──► blocked
                     │   │
                     │   └──► failed ──► pending   (retry, attempts increments)
                     ▼
              cancelled (terminal)
        blocked ──► ready / failed / cancelled
```

- **Claim**: `ready → running` records `assigned_to` + `started_at` (pass `claim_by` over MCP)
- **Completion**: transitioning to `passed` / `failed` auto-records `completed_at`
- **Protection**: illegal transitions (e.g. `pending → running`) return an explicit error — **never silent**

---

## MCP: let AI agents do the work 🤖

Super Plumber ships an MCP Server (stdio transport). Coding agents read the graph, create nodes, claim tasks, and report progress like any other tool.

### Start it

```bash
graph-mcp
```

### Wire it up (configure once globally — works in every project)

**Recommended: install globally and configure once. No paths, no `--root` needed.**
The server locates the current project's graph on every tool call (see resolution order below), so switching projects or opening new sessions requires zero config changes.

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

**Universal npx form** (no global install; works with any MCP-capable client):

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

> Since v0.4.1 the global install also registers a package-named `super-plumber` command
> (same MCP server), so the npx form shortens to `npx -y @lukawi/super-plumber`.

**Graph auto-location** (evaluated per tool call, highest priority first):

1. `--root <dir>` launch arg / `SUPER_PLUMBER_ROOT` env var — only if you want to pin the server to one graph;
2. **MCP workspace roots**: the client reports the currently open project root(s) over the MCP protocol; the first one containing `.graph/` wins;
3. walk **up from the server process cwd** looking for `.graph/graph.yaml` (agents started inside a subdirectory still hit the project root);
4. nothing found → a readable error ("graph not initialized… run graph init or pass --root") — never a silently empty graph.

> Pinning to a single fixed graph (testing etc.): `"command": "graph-mcp", "args": ["--root", "/path/to/graph"]`.

### The 18 tools

| Tool | Purpose | Required params |
|------|---------|-----------------|
| `graph_get_node` | Read a node's full content | `id` |
| `graph_create_node` | Create a node | `id, label` |
| `graph_update_node_status` | State transition; **pass `claim_by` when `status=running` to claim** | `id, status` |
| `graph_update_checkpoint` | Report checkpoint progress mid-execution | `node_id, checkpoint_id, status` |
| `graph_update_execution_report` | Submit the handoff report (for spot-checking) | `node_id, summary` |
| `graph_delete_node` | Soft-delete | `id` |
| `graph_get_graph` | Full topology (nodes + edges + adjacency) | — |
| `graph_traverse` | Traverse neighbors from a node | `node_id` |
| `graph_search` | Search nodes by criteria | `query/status/type/assigned_to` |

**Reliability by design**: every param is zod-validated — missing params / invalid enums return `-32602` protocol errors; nonexistent nodes/edges return `isError=true` with readable messages; illegal state transitions error explicitly. **Tools never fail silently.**

---

## Web UI (Svelte 5 + D3.js)

```bash
graph serve
# auto-opens the default browser at http://localhost:8934; CI/headless: `graph serve --no-open`
```

- **Force-directed graph**: zoom / pan / auto-fit, colored by node status
- **Edge-type visualization**: distinct color per type, hover highlight
- **Flow dots**: animated dots travel the downstream edges of `running` nodes (the "vascular" metaphor)
- **Checkpoint progress bars**: sub-step completion shown under each node
- **Assignee labels**: `assigned_to` shown next to `running` nodes
- **WebSocket delta push**: node changes push `node:updated` deltas (not full re-sends); automatic HTTP fallback when the socket drops

---

## Storage Layout (Git-friendly, human-readable)

```text
.graph/                    # runtime directory (created by graph init; gitignored)
├── graph.yaml             # graph definition: entry/exit/root context + node/edge reference lists
├── nodes/*.yaml           # node files: plan / checkpoints / expected_outcome / execution_report
├── edges/*.yaml           # edge files: source / target / type / contract
├── snapshots/<id>/        # version snapshots: manifest + full file copies (graph snapshot)
├── events.jsonl           # append-only event log (read with graph events; commit it for audit or gitignore it)
└── index/                 # derived indexes (graph.json / meta.json — deletable, rebuildable)
```

**Design principles:**

- **Git is the single source of truth** — all data is files: diffable, revertable, reviewable
- **File-as-node** — one node = one YAML, editable with a plain text editor
- **Structure over prose** — YAML schema constraints; no free-form Markdown ambiguity
- **Pure file system** — no database; soft-delete keeps `.deleted.yaml` history

> The repo ships an example topology at `.graph-example/` (20 nodes / 36 edges + a `setup-topology.sh` rebuild script) — a good reference for node/edge authoring style.

---

## Pi Agent Ecosystem: subagents + skill

The repo includes 2 dedicated subagents (`.pi/agents/`) and 2 phased skills (`.pi/skills/plumber-design/` + `.pi/skills/plumber-execute/`):

| Agent | Role | Responsibilities |
|-------|------|------------------|
| `sp-designer` | Topology designer | Decompose requirements into a structured topology; author each node's plan and definition of done |
| `super-mario` | Topology controller | Node lifecycle adjudication (checkpoint aggregation + output spot-checks), retry management, status monitoring |

**Two-phase skill protocol**: `plumber-design` owns the **design phase** (decompose requirements → build the topology → `graph validate` + a design check script prove it's bug-free → `graph serve` opens a browser preview → request user approval; approval is a hard gate). Once approved, `plumber-execute` owns the **execution phase** (claim → checkpoint-by-checkpoint reporting → execution_report → passed; fan_out/fan_in structure plus a condition check decide when to dispatch parallel subagents; when all task nodes pass, run the 3-layer acceptance: status all-green + `graph validate` 0 errors + acceptance criteria checked one-by-one against real artifacts). Scripts: `sp-check-design.mjs` (design check) on the design side; 6 on the execute side (read/status/claim/checkpoint/report/traverse) — agents operate the graph by protocol, never out-of-band or with fake progress.

---

## Development & Testing

```bash
# Build from source
git clone https://github.com/LUKAWI/super-plumber
cd super-plumber
npm install
npm run build && npm --prefix web-ui run build

# Tests (316 backend + 36 frontend cases)
npm test

# Link globally for local dev
npm link
graph --version
```

---

## FAQ

| Problem | Cause & fix |
|---------|-------------|
| `❌ 未找到 .../.graph/graph.yaml，请先运行 graph init` | No graph in the current directory. Run `graph init`, or `cd` into the graph directory |
| `❌ 端口 8934 已被占用` | Another serve is running. Use `graph serve -p 8935` |
| `❌ Node x already exists` / `Edge x already exists` | Duplicate id. The tool refuses to overwrite — pick a new id |
| `❌ Invalid transition: ...` | You skipped a legal path in the state machine. Follow `Allowed: [...]` |
| `❌ MCP error -32602: ...` | Missing/invalid params on an MCP call — read the hint and fix the argument |
| `❌ 节点不存在: x` | Node doesn't exist (soft-deleted or wrong id). Confirm with `graph status` / `graph_search` |
| Global command unchanged after code edits | Global install is the published snapshot. `npm version patch && npm publish && npm i -g @lukawi/super-plumber` |
| `graph serve` shows an empty graph | Check `cwd` is the graph directory; empty graphs show an onboarding empty state |

---

## Project Status

```text
Tests: 316 backend + 36 frontend ✅ | CLI: 22 commands | MCP: 20 tools | State machine: 7 states + ready gate + max_attempts + passed hard gate + event-log audit + ADR 3-state machine (knowledge vertices exempt) | Edge types: 9 | Versioning: snapshot/diff/rollback (incl. design-only) | Web UI: Svelte 5 + D3.js (map lenses)
```

- **npm**: [@lukawi/super-plumber](https://www.npmjs.com/package/@lukawi/super-plumber)
- **GitHub**: [LUKAWI/super-plumber](https://github.com/LUKAWI/super-plumber)
- **Architecture decisions**: `docs/adr/` (topo sort ignores runtime edges / file-system storage)
- **Domain vocabulary**: `CONTEXT.md`

## License

MIT © 2026 Super Plumber contributors
