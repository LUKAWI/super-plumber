---
name: plumber-flow
description: Use when breaking a task or requirement into an executable workflow, designing a task topology graph with the super-plumber, executing nodes in dependency order, or updating node progress (claim/checkpoint/execution_report). Also use when an agent needs to create, read, update, or traverse nodes/edges of a .graph/ topology, or when asked to "build a plan as a graph", "decompose into tasks", "track progress on a topology", or run graph CLI/MCP tools. Do NOT use for plain todo lists — the graph is the product, not a side note.
---

# Graph Workflow — Decompose → Design → Execute → Report

## Overview

The super-plumber (`graph`) is a workflow topology manager: nodes are tasks, edges are typed dependencies, and every node carries a lifecycle state. **Your job is to drive a requirement through it end-to-end: decompose → design the graph → execute nodes in order → report progress.** The `.graph/` YAML files are the source of truth. The graph is the deliverable, not a side note.

**Violating the letter of this protocol is violating its spirit. No shortcuts.**

---

## The Protocol (5 Phases — do them IN ORDER, never skip)

### Phase 1 — Decompose the requirement

- Break the requirement into 3–20 concrete, dependency-linked tasks.
- Each task gets: an id (`l1_*` for top-level, `l2_*` for children), a label, and a clear definition of done.
- Identify the **entry** (the human requirement) and the **exit** (the acceptance criteria) FIRST. Every graph has exactly one entry and one exit, both at level 0.

### Phase 2 — Design the topology

- **ALWAYS define entry and exit before any nodes.** Empty entry/exit produces a validate warning (and the CLI has no dedicated command to fill them — edit .graph/graph.yaml by hand). Never ship a graph without them.
- Create nodes at L1 (arteries), then L2 (capillaries) under them.
- **Every node MUST carry:**
  - `plan.description` — what the node does
  - `checkpoints` — at least 1 sub-step (`{id, label}`); the executor reports each one
  - `expected_outcome.definition_of_done` — completion criteria
- Add typed edges: `depends_on` / `validates` participate in topological sort; `shares_context`, `fan_out`, `fan_in`, `fallback`, `iterates` are runtime edges.
- **ALWAYS run `graph validate` after building or editing the graph.** Fix every error before proceeding.

### Phase 3 — Build the graph (pick the tool)

| Task | Use |
|------|-----|
| Initialize graph, create nodes/edges, bulk edits | **CLI** (`graph` — globally installed via `npm link` / `npm install -g`) |
| Everything else: read node, claim, checkpoint, execution report, search, traverse | **MCP** (9 tools, zod-validated) or helper scripts |

> **NEVER treat MCP as optional.** The CLI is a SUBSET of the MCP tools. Claim, checkpoint, and execution_report exist ONLY via MCP/scripts — the CLI has no such commands. If you only use the CLI, you lose half the protocol.

**Common CLI commands:**

```bash
GRAPH="graph"   # globally installed — `npm link` / `npm install -g super-plumber`
$GRAPH init -l "项目名"                       # create .graph/ skeleton
$GRAPH create-node -i l1_register -l "注册模块" -t task --level 1 --plan-desc "..." --dod "完成标准A" --dod "完成标准B"
$GRAPH add-edge -i e1 -s l1_login -t l2_auth --type depends_on
$GRAPH status                                   # overview + topo check
$GRAPH validate                                 # MUST after every edit
$GRAPH update-status -i l1_register -s running  # state machine enforced
$GRAPH export --mermaid -o flow.mmd             # visualize
```

**All scripts** (read/status + protocol executors; from `~/.pi/agent/skills/plumber-flow/scripts/` — project: `.pi/skills/plumber-flow/scripts/`). Thin wrappers over the core engine — use when no MCP client is available:

```bash
./graph-get-node.sh <node_id>            # read one node's full content
./graph-traverse.sh <node_id> [upstream|both] [depth]   # walk neighbors
./graph-update-status.sh <node_id> <status>  # status change w/ state machine check
node graph-claim.mjs <node_id> <claim_by>      # Phase 4 step 1: ready→running, records assigned_to + started_at
node graph-checkpoint.mjs <node_id> <cp_id> <status>   # Phase 4 step 3: report one checkpoint as you finish it
node graph-report.mjs <node_id> <summary> [artifacts.csv] [blockers.csv] [notes]  # Phase 4 step 4: handoff
```

> The state machine is enforced in these scripts — claiming a non-ready node throws `Invalid transition`, never fake-success.

**MCP tools (9)** — prefer these for anything beyond init/bulk-create:

| Tool | Purpose | Required params |
|------|---------|-----------------|
| `graph_get_node` | read node tarball | `id` |
| `graph_create_node` | create node | `id, label` |
| `graph_update_node_status` | change status; **claim semantics: pass `claim_by` when `status="running"`** | `id, status` |
| `graph_update_checkpoint` | report checkpoint progress | `node_id, checkpoint_id, status` |
| `graph_update_execution_report` | submit handoff report | `node_id, summary` |
| `graph_delete_node` | soft delete | `id` |
| `graph_get_graph` | full topology + adjacency | — |
| `graph_traverse` | neighbors | `node_id` |
| `graph_search` | filter nodes | `query/status/type/assigned_to` |

### Phase 4 — Execute nodes in topological order

**The executor protocol — follow EXACTLY, in order:**

1. **CLAIM** — pick a `ready` node. `graph_update_node_status {id, status: "running", claim_by: "<your-agent-name>"}`. This records `assigned_to` + `started_at` atomically.
   - NEVER claim a node that isn't `ready`. State machine will reject it — check `graph_get_graph` or `graph_search` first.
2. **WORK** — execute the node's `plan`; keep its `checkpoints` as your checklist.
3. **REPORT AS YOU GO** — after EACH checkpoint, call `graph_update_checkpoint {node_id, checkpoint_id, status}`. **Never batch them at the end.** A finished checkpoint not reported is lost progress.
4. **HAND OFF** — when the work is done, call `graph_update_execution_report {node_id, summary, artifacts, blockers, notes}`. List real artifact paths — the verifier spot-checks them.
5. **NEVER mark a node `passed` without a submitted execution_report.** Passed without a handoff is a lie.

### Phase 5 — Update progress & verify

- After a node passes, its downstream `ready` nodes become executable — keep pulling from the queue.
- `failed` → retry via `pending` (attempts auto-increment; stops at `max_attempts`).
- **ALWAYS `graph validate` + `graph status` before reporting completion.** Evidence before assertions.

---

## State Machine (7 states)

```
pending → ready → running → passed → blocked
                         ↘ failed → pending (retry)
        any state → cancelled (terminal)
        blocked → ready / failed / cancelled
```

- Claim = `ready → running` (+ `claim_by`).
- `passed`/`failed` auto-record `completed_at`.
- Invalid transitions throw explicit errors — never force one.

## Edge Types (7)

`depends_on` ✅topo · `validates` ✅topo · `shares_context` · `fan_out` · `fan_in` · `fallback` · `iterates` (runtime, not sorted)

---

## Common Mistakes (each one was observed live — do not repeat them)

| Mistake | Fix |
|---------|-----|
| Skipping entry/exit, building only L1 nodes | Phase 2: entry + exit FIRST, always |
| Creating bare nodes (no plan/checkpoints/dod) | Phase 2: every node carries all three |
| Using only CLI and claiming it's "done" | CLI is a subset — MCP/scripts for claim/checkpoint/report |
| `pending → running` in one shot | State machine rejects it. Go `ready` first |
| Marking passed without execution_report | Phase 4 step 5 — never |
| Batching checkpoint updates at the end | Report each one as you finish it |
| Not validating after edits | `graph validate` after every structural change |
| Inventing commands/flags | Run `--help` or read this skill's tables |

## Red Flags — STOP and fix

- "I'll skip entry/exit, it's just a demo"
- "CLI covered everything" (it didn't — where's the execution_report?)
- "I'll report checkpoints at the end" (report as you go or it's lost)
- "I'll mark it passed, details later" (passed needs the handoff NOW)
- "validate has warnings, but..." (warnings are fixable — fix them)
- Graph edited → `graph validate` not run

## When NOT to use

- Pure todo/task-list tracking without dependencies or lifecycle — use a todo list.
- Reading an existing graph without executing it — read `reference.md` in this skill directory.
