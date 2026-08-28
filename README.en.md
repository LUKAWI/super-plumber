# Super Plumber 🚰 — AI Agent Workflow Topology Graph Manager

> Turn "task documents" into **graphs agents can natively understand**: nodes are tasks, edges are dependencies, a state machine owns the lifecycle.
> One install, three access layers (CLI / MCP / Web UI), pure YAML file storage (no database, no server).

[![npm version](https://img.shields.io/npm/v/@lukawi/super-plumber)](https://www.npmjs.com/package/@lukawi/super-plumber)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-504%2F504-green)](https://github.com/LUKAWI/super-plumber/actions)
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
| 🗂️ **Multi-graph workspace (v0.5.2)** | One `.graph/` manages multiple named graphs: `graph switch` like git branch (workspace default + per-process MCP active, two-layer semantics), `graph init <name>`/`list`/`rename-graph`/`delete-graph` (.trash soft delete), `--graph` flag and `SUPER_PLUMBER_GRAPH` on every command; legacy repos stay compatible (one-shot locked migration when the second graph is born); per-graph locks/index/events/snapshots |
| 🧭 **Typed topology** | 9 edge types: `depends_on` / `validates` participate in topological sort; `shares_context` / `fan_out` / `fan_in` / `fallback` / `iterates` express runtime control flow; `decides` / `relates` (v0.5) carry domain knowledge |
| 🏛️ **Domain semantics (v0.5)** | **Bounded contexts and ADRs are first-class graph citizens**: context vertices follow "node as document" (boundary + glossary); node membership (`--context`) derives workflow/domain maps; **ADR state machine** proposed→accepted→superseded (supersede requires a successor; propose/adjudicate separation); `graph adr` command group + MCP `graph_create_adr`; decision changes propagate along decides edges (claim responses inject `governing_adrs` pointers, scheduling entries get `adr_flags` ⚠️); cross-context workflow edges are contract edges (contract required); `graph export --docs` regenerates docs/adr + CONTEXT-MAP.md + per-context CONTEXT.md (graph is the source of truth, markdown is a view) |
| 🔄 **Enforced state machine** | 7 states + three hard rules: ready gate (gating predecessors must be `passed`), max_attempts cap, and a **passed hard gate** (no execution report / unaggregated checkpoints / failed verdict → `passed` rejected); concurrent claims are atomic under a lock; knowledge vertices are exempt (context is stateless, ADR has its own 3-state machine) |
| 🤖 **Native MCP** | 24 `graph_*` tools covering the whole flow: design (batch create / add edge / edit entry-exit / **graph_create_adr**), execution (atomic claim with governing-ADR pointers / checkpoint / report / **reclaim of dead claims**), adjudication (verdict), versioning (snapshot/diff/rollback), self-check (**graph_validate**: structure + domain rules + reference drift), audit (**graph_events**: event-log replay) — all with zod-validated params |
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
graph --version     # prints 0.6.0 on success
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

### Step 3 — Connect edges (7 workflow + 2 knowledge types)

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
| `decides` | ADR → any vertex: decision governance; supersession propagates adr_flags along it (v0.5 knowledge edge) | ❌ |
| `relates` | context ↔ context: domain relationship, free-form `--rel-kind` label (v0.5 knowledge edge) | ❌ |

> `depends_on` / `validates` feed the topological sort; other workflow edges express runtime control flow and are ignored for sorting (e.g. `fallback`'s backward reference won't be misreported as a cycle); knowledge edges (`decides` / `relates`) are excluded from sorting and gates.

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

> **Try creating a cycle on purpose**: `graph add-edge -i e_cycle -s l1_login -t l1_register --type depends_on`
> validate reports `检测到循环依赖: l1_register → l1_login → l1_register` — the tool won't let you ship a graph with a cycle.

### Step 5 — Execute (state-machine driven, claimed by a human or an agent)

```bash
# State machine: pending → ready → running → passed
graph update-status -i l1_register -s ready      # deps done, ready to run
graph update-status -i l1_register -s running    # claim: records start time (pass `--claim-by <agent>` to record the executor)
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
graph export --mermaid -o flow.mmd    # export a Mermaid flow diagram (knowledge vertex shapes/colors + per-type edge styles, header carries entry/exit + legend)
graph serve                           # open http://localhost:8934 for the force-directed view
```

---

## CLI Reference (27 commands)

| Command | Purpose | Key flags |
|---------|---------|-----------|
| `graph init` | Initialize: a fresh repo must create a named graph (v0.5.2); on a legacy repo, `init <name>` = migrate + create | `<name>` content-named graph id (required for fresh repos, e.g. refactor-auth); `-l <label>` display name; `--force` trash-and-rebuild same-name graph / reset legacy single graph |
| `graph switch` | Switch the workspace default graph (writes `.graph/active`); no arg prints the current graph (with source) | `[<name>]`; warns about in-flight running nodes on the previous default |
| `graph list` | List all graphs in the workspace (or one graph's detail) | `[<name>]`; `--json` |
| `graph rename-graph` | Rename a graph (directory moves, active fixed up, audited); CLI human channel only | `-o <old>` `-n <new>` |
| `graph delete-graph` | Delete a graph (soft delete into `.trash/`, manually recoverable; refuses the last graph / the active default); CLI human channel only | `-i <name>` `--confirm` |
| `graph create-node` | Create a node (plan + DoD in one call; checkpoints go through `update-node`) | `-i <id>` `-l <label>` `-t <type>` (task/checkpoint/decision/gate/context/adr) `--level <n>` `--priority <n>` (lower runs first) `--context <ctx_id>` (v0.5 membership) `--plan-desc <text>` `--dod <item>` (repeatable) `--assigned-to <agent>` |
| `graph get-node` | Read a node + allowed transitions + gate status (optional topology neighbors) | `-i <id>`; `--json` stable output; `--neighbors up\|down\|none` |
| `graph add-edge` | Add a typed edge (core validates endpoints) | `-i <id>` `-s <source>` `-t <target>` `--type <one of 9>`; `--contract '<json>'` cross-context contract; `--rel-kind <text>` |
| `graph update-status` | State transition (state machine + ready gate + max_attempts + passed hard gate) | `-i <id>` `-s <status>`; `--claim-by <agent>` to claim; `--force` human ops only |
| `graph reclaim` | Reclaim a dead claim: running → pending (clears assignee, notes the reclaim) | `-i <id>`; `--by <actor>` |
| `graph update-node` | Update node details | `-i <id>` `--plan-desc` `--add-dod <item>` (repeatable) `--clear-dod` `--add-checkpoint '<JSON>'` (repeatable) `--set-assigned <agent>` `--label <text>` `--max-attempts <n>` `--set-priority <n>` `--set-context <ctx_id>` `--boundary <text>` `--glossary-add '<JSON>'` (repeatable) `--reset-attempts` (explicit, audited) `--show` |
| `graph update-graph` | Edit entry/exit/acceptance criteria/label (no hand-editing graph.yaml) | `--entry-desc` `--exit-desc` `--add-criteria <item>` (repeatable) `--clear-criteria` `--label` `--set-context '<json>'` |
| `graph adr` | ADR lifecycle command group (v0.5): create lands as proposed; accept/supersede are adjudication | `create -t <title> -d <decision>`; `accept -i <id>`; `supersede -i <id> --by <id>`; `list [-s <status>]` |
| `graph delete-node` | Soft-delete a node; refused while edges reference it | `-i <id>`; `--cascade` deletes referencing edges too |
| `graph delete-edge` | Soft-delete an edge (keeps `.deleted.yaml` history) | `-i <id>` |
| `graph status` | Status overview + topo check | `--json` |
| `graph validate` | schema + references + topo sort + cycles (per-file locating) | `--json` |
| `graph next` | Scheduling decision: claimable / ready-eligible / waiting / running / possibly stale | `--stale-ms <ms>` (default 30 min); `--json` |
| `graph verdict` | Record an adjudication verdict (Super Mario) | `-i <id>` `--verdict passed\|failed\|pending` `--note <text>` |
| `graph snapshot` | Create a version snapshot | `-m <msg>`; `--git` also git-commits |
| `graph snapshots` | List snapshots | `--json` |
| `graph diff` | Diff topologies (default: latest snapshot vs current) | `--from <id>` `--to <id>`; `--json` |
| `graph rollback` | Rollback (auto-backup first) | `<snapshot-id>` `--confirm` (required); `--design-only` keeps execution progress |
| `graph events` | Read the append-only event log (audit trail) | `--node <id>` `--kind <k>` `--last <n>`; `--json` |
| `graph rebuild` | Rebuild `index/` derived indexes (graph.json + meta.json + topology.dot) | — |
| `graph export` | Export a Mermaid diagram (contexts as teal pills without status lines, ADRs as hexagons colored by three states, edge styles per type, header comment with entry/exit + legend); `--docs` exports domain docs views (graph is the source of truth, md is a view) | `--mermaid -o <file>`; `--docs` (ADRs → docs/adr/, contexts → CONTEXT-MAP.md + docs/contexts/; `--adr-dir`/`--ctx-dir`) |
| `graph serve` | Start the Web UI (auto-opens browser) | `-p <port>` (default 8934); `--no-open` to skip |

> Not sure about flags? Every command has `--help`: `graph create-node --help`.

### Shortcuts (aliases)

Common commands accept 1-2 character aliases; full names still work (equivalent):

| Full command | Alias | Full command | Alias |
|--------------|-------|--------------|-------|
| `graph init` | `graph i` | `graph update-node` | `graph un` |
| `graph create-node` | `graph cn` | `graph delete-node` | `graph dn` |
| `graph get-node` | `graph gn` | `graph delete-edge` | `graph de` |
| `graph add-edge` | `graph ae` | `graph update-graph` | `graph ug` |
| `graph update-status` | `graph us` | `graph next` | `graph n` |
| `graph reclaim` | `graph rc` | `graph verdict` | `graph vd` |
| `graph snapshot` | `graph sp` | `graph snapshots` | `graph sps` |
| `graph diff` | `graph d` | `graph rollback` | `graph rol` |
| `graph status` | `graph s` | `graph validate` | `graph v` |
| `graph export --mermaid` | `graph x --mermaid` | `graph rebuild` | `graph rb` |
| `graph serve` | `graph sv` | `graph switch` | `graph sw` |
| `graph list` | `graph ls` | `graph rename-graph` | `graph rg` |
| `graph delete-graph` | `graph dg` | | |

E.g. `graph cn -i t1 -l "Task 1"` ≡ `graph create-node -i t1 -l "Task 1"`.

---

## State Machine (7 states, 16 transitions)

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
- **Passed hard gate**: `running → passed` is rejected by the core layer when the execution report is missing (empty summary), a verdict is `failed`, or checkpoints are not aggregated (`--force` is human-ops only)
- **Reclaim**: `graph reclaim` returns a dead claim from `running` to `pending` (recovery after an executor crash); `cancelled` can be reopened as `pending`
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
3. walk **up from the server process cwd** looking for a `.graph/` directory (agents started inside a subdirectory still hit the project root);
4. nothing found → a readable error ("graph not initialized… run graph init or pass --root") — never a silently empty graph.

> Once the workspace is located, the current graph inside it resolves as (v0.5.2): `SUPER_PLUMBER_GRAPH` env var > in-process active (set by `graph_switch`, MCP only) > `.graph/active` workspace default > default fallback; `graph_switch` switches in-process and never rewrites the workspace default (CLI data commands additionally take a leading `--graph` flag).
>
> Pinning to a single fixed graph (testing etc.): `"command": "graph-mcp", "args": ["--root", "/path/to/graph"]`.

### The 24 tools

**Scheduling**: `graph_get_next_actions` — one call returns claimable (ready) / ready-eligible (pending/failed whose gates are satisfied — the cold-start entry) / waiting-on-deps (blocked, with unmet predecessors) / running (with elapsed time) / possibly-stale (stale_running), paginated per bucket (`limit` + `truncated`), entries may carry `adr_flags` (stale decision basis ⚠️) — the first call of any agent planning loop.

**Multi-graph (v0.5.2)**: `graph_switch` (in-process switch of the current graph: named switch + summary / no-arg shows current; restart falls back to the workspace default), `graph_list_graphs` (list all graphs with is_current / single-graph detail); every tool response carries the graph name; cross-graph hints (a node/edge id missing from the current graph → the error notes "it exists in graph X, run graph_switch first" — never auto-switches).

**Reads**: `graph_get_node` (node + allowed transitions + checkpoint aggregate + gate status + **governing_adrs pointers**, optional topology neighbors), `graph_get_graph` (compact summary mode by default, `mode=full` + `offset/limit` pagination), `graph_traverse` (`max_nodes` cap), `graph_search` (`limit` cap + compact results; `--type adr/context` finds knowledge vertices).

**Design-time writes**: `graph_create_node` (full bundle with plan/DoD/checkpoints; `type=context/adr` and `context` membership), `graph_create_adr` (v0.5: auto-numbered adr_NNNN, lands as proposed — propose/adjudicate separation; accept/supersede belong to Super Mario/humans), `graph_batch_create` (batch nodes+edges, full pre-validation reporting all conflicts), `graph_add_edge` (incl. `decides`/`relates` knowledge edges with `contract`/`rel_kind`), `graph_update_node` (incl. domain fields `set_context`/`boundary`/`glossary_add`/`superseded_by`), `graph_update_graph` (entry/exit/acceptance criteria), `graph_delete_node` (refuses while referenced, `cascade` deletes together), `graph_delete_edge`.

**Execution-time writes**: `graph_update_node_status` (`claim_by` with `status=running` performs an **atomic claim** — concurrent double-claims fail for the loser, response carries governing_adrs pointers; **force is rejected at protocol level on the MCP channel** — human ops go through CLI `--force` with a force_override audit event; the ADR state machine flows through this tool too, supersede is two-step: `graph_update_node {superseded_by}` first, then the status), `graph_update_checkpoint` (checkpoint state machine + idempotent), `graph_update_execution_report` (handoff + `verification` verdict), `graph_reclaim_node` (reclaim dead claims: running → pending). Attempts reset requires an explicit `reset_attempts: true` on `graph_update_node` (plan edits no longer reset implicitly; a reset always writes an audit event).

**Versioning**: `graph_snapshot` / `graph_diff` / `graph_rollback` (requires `confirm: true`; `design_only: true` rewinds design only, keeping execution progress).

**Self-check & audit (v0.6.0)**: `graph_validate` (cycle/ghost-edge/schema/six domain rules/reference-list drift in one summary, structured ok/errors/warnings — the self-check after batch creates or crash recovery), `graph_events` (event-log replay with `node`/`kind` filters and `last` tail; claim/force_override/attempts_reset traceable).

**Reliability by design**: every param is zod-validated — missing params / invalid enums return `-32602` protocol errors; nonexistent nodes/edges return `isError=true` with readable messages; illegal state transitions, gate violations, attempt caps and the passed hard gate error explicitly. **Tools never fail silently.**

---

## Web UI (Svelte 5 + D3.js)

```bash
graph serve
# auto-opens the default browser at http://localhost:8934; CI/headless: `graph serve --no-open`
```

- **Force-directed graph**: zoom / pan / auto-fit / fixed-layout toggle, colored by node status
- **Map lenses (v0.5)**: checkbox any subset of the **workflow map / domain map** — the domain view renders context vertices + relates edges with boundary and glossary detail; the overlay view wraps members in D3 cluster hulls, badges ADRs, and highlights cross-context contract edges; the UI stays strictly read-only
- **Edge-type visualization**: distinct color per type (9 types), hover highlight, **click an edge for its semantics and contract** (decides/relates carry domain meaning)
- **Flow dots**: animated dots travel the downstream edges of `running` nodes (the "vascular" metaphor)
- **Checkpoint progress bars**: sub-step completion shown under each node; the detail panel shows the execution report (handoff + verdict badge)
- **Assignee labels**: `assigned_to` shown next to `running` nodes
- **Layer drill-down & search**: L0–L5 level chips to filter/highlight + id/label search + status summary bar
- **Version diff view**: snapshot list → added (green) / removed (red) / modified (yellow) coloring on the canvas + status-change details
- **WebSocket delta push**: node changes push `node:updated` deltas (not full re-sends); edge changes update the edge layer only; **automatic reconnection with exponential backoff** (+ HTTP fallback refresh)

---

## Storage Layout (Git-friendly, human-readable)

```text
.graph/                    # workspace directory (created by graph init; gitignored)
├── active                 # workspace default graph name (rewritten by graph switch)
├── schema.yaml            # human-readable schema doc (runtime validation lives in core/schema.ts)
├── workspace-events.jsonl # workspace-level audit (init/switch/migrate/rename/delete)
├── <graph-name>/          # one first-level directory per graph (v0.5.2; per-graph locks/index/events/snapshots)
│   ├── graph.yaml         # graph definition: entry/exit/root context + node/edge reference lists
│   ├── nodes/*.yaml       # node files: plan / checkpoints / expected_outcome / execution_report
│   ├── edges/*.yaml       # edge files: source / target / type / contract
│   ├── snapshots/<id>/    # version snapshots: manifest + full file copies (graph snapshot)
│   ├── events.jsonl       # append-only event log (read with graph events; commit it for audit or gitignore it)
│   └── index/             # derived indexes (graph.json / meta.json / topology.dot — deletable, rebuildable)
└── .trash/                # delete-graph soft-delete trash (manually recoverable)
```

> Legacy repos stay compatible with zero migration: an old flat `.graph/graph.yaml` at the root is recognized in place as the `default` graph; a one-shot locked migration into `.graph/default/` happens when the second graph is created.

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

## Multi-Tool Integration (v0.6.1)

The same workflow assets (role prompts / phase skills / execution scripts / the Operations manual) ship in two integration forms — pick the one that matches your agent tool:

| Integration path | How to install |
|------------------|----------------|
| **pi** (in-repo, native) | Use the repo-root `.pi/` in place; to carry it into other projects, copy the whole `.pi/` directory to the project root |
| **Claude Code** (plugin `super-plumber`) | `/plugin marketplace add lukawi/super-plumber`, then install `super-plumber`; to preview a local checkout, run `claude plugin marketplace add ./` at the repo root |
| **ZCode** (same plugin) | Settings → Plugin management → Discover → add the marketplace source `lukawi/super-plumber` (or a local directory), then install `super-plumber` |

> Claude Code and ZCode install **the same plugin package** (`integrations/plugin/`, carried by the `.claude-plugin` manifest; ZCode loads it through the `.claude-plugin` compatibility fallback, with agents auto-discovered from the conventional in-package directory) — one package, two tools.

What you get:

- **2 slash commands**: `/plumber-design` — design-phase orchestration (decompose the requirement → build the topology → validate/doctor both green → browser preview → request user approval); `/plumber-execute` — execution-phase orchestration (claim → report checkpoints as you go → handoff report → three-layer acceptance). pi has no slash commands; the two `.pi/skills/` phases drive the same flow directly.
- **2 subagents**: `sp-designer` (topology designer) and `super-mario` (adjudication controller), dispatched by the skills via dispatch templates; when no subagent is available, the skills' solo branch runs on the main thread.
- **The Operations manual** — the single source of truth for operational syntax. pi users read `integrations/shared/manual.md` from the repo root; plugin users read `manual.md` inside the plugin package (a build-time-synced copy). Whenever a prompt or skill says "Read manual §N", resolve it this way (conventions in manual §11).

### Solo mode (one person, one session, no separate adjudicator)

When the main thread plays the designer and executor roles itself, the adjudication boundaries are codified (manual §10): **mechanical checks you may settle yourself** — checkpoint aggregation, artifact existence, the status and structure acceptance layers; let the numbers speak and keep evidence in your notes. **Judgment calls must go to a human** — subjective DoD quality, ADR accept/supersede, the user approval gate, and any force-type action: stop, itemize, and present; never sign on anyone's behalf.

### npm fallback (when marketplace sources are unreachable)

The npm package ships the integration assets (`files` in `package.json` includes `integrations/` and `.pi/`). After installing, copy `integrations/plugin/` out of `node_modules/@lukawi/super-plumber/` (point Claude Code / ZCode at that directory to install), or copy `.pi/` to your project root — no GitHub access required.

### Using ZCode without the plugin

You can also skip the plugin entirely: copy the agent definition md files into `~/.zcode/agents/` (user level) and ZCode will pick them up. If you place them at the project level (`<repo>/.zcode/agents/`) instead, note that a `permissionMode` frontmatter field is stripped from project-level agents (permission fields only take effect at user level), and the reserved names `general-purpose` and `Explore` cannot be used.

---

## Development & Testing

```bash
# Build from source
git clone https://github.com/LUKAWI/super-plumber
cd super-plumber
npm install
npm run build && npm --prefix web-ui run build

# Tests (504 backend + 54 frontend cases)
npm test

# Link globally for local dev
npm link
graph --version
```

---

## FAQ

| Problem | Cause & fix |
|---------|-------------|
| `❌ 未找到图（.../.graph 无 graph.yaml），请先运行 graph init <内容名>` | No graph in the current directory. Run `graph init <name>`, or `cd` into the graph directory |
| **MCP tools still behave like the old version after upgrading** (e.g. schema errors on context/adr vertices) | The connected MCP server process still runs the old code in memory. **Restart the MCP server** (reconnect the client, or restart it after `npm i -g @lukawi/super-plumber`) to load the new build — upgrades never hot-swap a running process |
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
Tests: 504 backend + 54 frontend ✅ | CLI: 27 commands | MCP: 24 tools | State machine: 7 states + ready gate + max_attempts + passed hard gate + event-log audit + ADR 3-state machine (knowledge vertices exempt) | Edge types: 9 | Versioning: snapshot/diff/rollback (incl. design-only) | Web UI: Svelte 5 + D3.js (map lenses)
```

- **npm**: [@lukawi/super-plumber](https://www.npmjs.com/package/@lukawi/super-plumber)
- **GitHub**: [LUKAWI/super-plumber](https://github.com/LUKAWI/super-plumber)
- **Architecture decisions**: `docs/adr/` (topo sort ignores runtime edges / file-system storage)
- **Domain vocabulary**: `CONTEXT.md`

## License

MIT © 2026 Super Plumber contributors
