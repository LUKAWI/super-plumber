---
name: plumber-tools
description: Use when operating the super-plumber workflow topology tool — running graph CLI commands, calling graph_* MCP tools, using helper scripts, or checking node status, state machine transitions, or edge types. Also use when debugging tool errors (MCP -32602, ENOENT, Invalid transition) while working with a .graph/ topology. Reference companion to plumber-flow; do NOT use for the workflow protocol itself — that is plumber-flow.
---

# Plumber Tools — Super Plumber Reference

## Overview

Super Plumber (`graph`) is a file-based workflow topology tool: nodes are YAML files, edges are typed dependencies, statuses follow a state machine. This skill is the **tool reference** — what exists, how to call it, and how to read its errors. The workflow protocol (decompose → design → execute → report) lives in **plumber-flow** — use that for process, this for tools.

**One rule governs everything: tools validate. Errors are signals, never suggestions to bypass.**

## Access Layers — know what each can and cannot do

| Layer | Use for | Cannot do |
|-------|---------|-----------|
| **CLI** `graph` | init, bulk create/edge, status, validate, rebuild, export, serve | claim / checkpoint / execution_report (MCP-only) |
| **MCP** `graph_*` (9 tools) | everything, incl. claim semantics, zod-validated | — |
| **Scripts** (this skill + plumber-flow) | quick read/traverse/status/claim when no MCP client | — |

> **NEVER treat the CLI as a complete replacement for MCP.** The CLI is a SUBSET. If you only use the CLI, claim, checkpoint, and execution_report are unreachable — the workflow cannot progress. `graph serve` runs the Web UI, not the MCP server.

## CLI Commands (11) — `graph <cmd>`

| Command | Purpose | Key flags |
|---------|---------|-----------|
| `init` | create `.graph/` skeleton | `-l <label>` |
| `create-node` | create node | `-i -l -t --level --plan-desc --dod(×N) --assigned-to` |
| `add-edge` | add typed edge | `-i -s -t --type` |
| `update-status` | state machine transition | `-i -s` |
| `update-node` | edit plan/DoD/checkpoints/assignee | `-i --plan-desc --add-dod --add-checkpoint --set-assigned --show` |
| `delete-node` | soft delete | `-i` |
| `status` | overview + topo check | — |
| `validate` | integrity + topo sort + cycles | — |
| `rebuild` | rebuild `index/` from sources | — |
| `export --mermaid` | Mermaid output | `-o <file>` |
| `serve` | Web UI (port 8934) | `-p <port>` |

```bash
# Minimal happy path
graph init -l "name"
graph create-node -i l1_a -l "Task A" --plan-desc "..." --dod "done A"
graph add-edge -i e1 -s l1_a -t l1_b --type depends_on
graph validate
```

**NEVER invent flags** — run `graph <cmd> --help`. **ALWAYS `graph validate` after structural edits.**

## Helper Scripts

From `~/.pi/agent/skills/plumber-tools/scripts/` (project: `.pi/skills/plumber-tools/scripts/`):

| Script | Usage | Notes |
|--------|-------|-------|
| `graph-get-node.sh` | `<node_id>` | dump one node's YAML |
| `graph-update-status.sh` | `<node_id> <status>` | state-machine-checked status change |
| `graph-traverse.sh` | `<node_id> [upstream\|both] [depth]` | walk neighbors (downstream default) |

Protocol scripts (claim/checkpoint/report) live in **plumber-flow** (`~/.pi/agent/skills/plumber-flow/scripts/`) — see that skill.

## MCP Tools (9) — the full capability surface

| Tool | Purpose | Required args | Watch out |
|------|---------|---------------|-----------|
| `graph_get_node` | read node tarball | `id` | — |
| `graph_create_node` | create node | `id, label` | duplicate id → error, never overwrite |
| `graph_update_node_status` | transition; **claim: `status:"running"` + `claim_by`** | `id, status` | must follow state machine order |
| `graph_update_checkpoint` | report checkpoint progress | `node_id, checkpoint_id, status` | one at a time, as you finish |
| `graph_update_execution_report` | submit handoff | `node_id, summary` | + `artifacts, blockers, notes` |
| `graph_delete_node` | soft delete | `id` | nonexistent id → error, not fake success |
| `graph_get_graph` | full topology + adjacency | — | — |
| `graph_traverse` | walk neighbors | `node_id` | `direction: downstream\|upstream\|both`, `max_depth` |
| `graph_search` | filter nodes | — | `query, status, type, assigned_to` |

**NEVER fake a node state without the corresponding tool call** (e.g. don't hand-edit YAML to mark a node passed). **NEVER claim a node that isn't `ready`.**

## State Machine (7 states)

```
pending → ready → running → passed → blocked
                         ↘ failed → pending (retry)
        any state → cancelled (terminal)
        blocked → ready / failed / cancelled
```

- `ready→running` = **claim** (records `assigned_to` + `started_at`); `passed`/`failed` records `completed_at`; `failed→pending` increments `attempts` (stops at `max_attempts`).
- A rejected transition is the machine protecting you — fix the order, don't force it.

## Edge Types (7)

| Type | Meaning | Participates in topo sort |
|------|---------|:---:|
| `depends_on` | sequential dependency | ✅ |
| `validates` | validation relationship | ✅ |
| `shares_context` | shared context | ❌ |
| `fan_out` | parallel dispatch | ❌ |
| `fan_in` | fan-in merge | ❌ |
| `fallback` | failure fallback | ❌ |
| `iterates` | iterative optimization | ❌ |

## Error Handling — read errors, then act

| You see | Meaning | Fix |
|---------|---------|-----|
| `MCP error -32602: Input validation error` + `expected string, received undefined at <field>` | missing required arg | pass the field |
| `-32602 ... expected one of "pending"\|"ready"\|...` | invalid enum | use a listed value |
| `Invalid transition: X → Y. Allowed: [...]` | state machine order violated | go through the allowed path |
| `ENOENT ... .graph/graph.yaml` | not initialized (or wrong cwd) | `graph init` / cd to the right dir |
| `Node X not found` | nonexistent id | check with `graph_search` / `graph status` |
| `Node X already exists` / `Edge X already exists` | duplicate id | choose a new id |

**NEVER ignore a tool error and continue as if it succeeded.** A silent fake-success is worse than a loud failure.

## Red Flags — STOP

- Running a graph workflow using only CLI commands (claim/report are unreachable)
- Hand-editing node YAML to skip the state machine
- `graph validate` failing and proceeding anyway
- Inventing tool names/params instead of reading this table or `--help`

## When NOT to use

- Workflow planning/execution protocol → **plumber-flow** (REQUIRED for the 5-phase process)
- Adjudicating node states → `super-mario` agent
