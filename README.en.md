# TopoGraph — Workflow Topology Graph Management Tool

> Restructure task documents and workflows into a topology that agents can natively understand (nodes / edges / state machine).
> Three access layers: CLI + MCP Server + Web UI. Pure YAML file storage (no database).
>
> **中文版:** [README.md](README.md)

```bash
npm install -g super-plumber
```

---

## Quick Start

```bash
# Initialize a .graph/ directory in the current project
graph init -l "My Project"

# Create a node
graph create-node --id task_001 --type task --label "Research requirements" --level 1

# Add a dependency edge
graph add-edge --id e001 --source task_001 --target task_002 --type depends_on

# View status
graph status

# Start the web visualization UI
graph serve
# Open http://localhost:8934
```

---

## CLI Commands (11)

| Command | Description |
|---------|-------------|
| `init` | Initialize the `.graph/` directory structure |
| `create-node` | Create a new node |
| `add-edge` | Add an edge between nodes |
| `update-status` | Update node status (state machine validation) |
| `update-node` | Update node detail (plan / expected_outcome / checkpoints) |
| `delete-node` | Soft-delete a node (keeps `.deleted.yaml` history) |
| `status` | Show a topology status overview |
| `validate` | Validate structural integrity (reference integrity + topo sort + cycle detection) |
| `rebuild` | Rebuild `index/` derived indexes from source files |
| `export --mermaid` | Export a Mermaid flow diagram |
| `serve` | Start the Web UI visualization service (port 8934) |

### Node State Machine

```text
pending → ready → running → passed → blocked
                         ↘ failed → pending (retry)
               any state → cancelled (terminal)
        blocked → ready / failed / cancelled
```

- **Claim semantics**: `update-status --status running` records the executor and `started_at`
- **Completion record**: transitioning to `passed`/`failed` automatically records `completed_at`
- **Retry**: `failed → pending` automatically increments `attempts`

### Edge Types (7)

| Type | Meaning | Participates in topo sort |
|------|---------|:---:|
| `depends_on` | Sequential dependency | ✅ |
| `validates` | Validation relationship | ✅ |
| `shares_context` | Shared context | ❌ |
| `fan_out` | Parallel dispatch | ❌ |
| `fan_in` | Fan-in merge | ❌ |
| `fallback` | Failure fallback | ❌ |
| `iterates` | Iterative optimization | ❌ |

---

## MCP Server (Agent Access)

Start the MCP server for coding agents:

```bash
graph-mcp
```

### Tools (9)

| Tool | Description | Params |
|------|-------------|--------|
| `graph_get_node` | Read a node's full content | `id` |
| `graph_create_node` | Create a node | `id, label` |
| `graph_update_node_status` | Update node status (claim: pass `claim_by` when `status=running`) | `id, status` |
| `graph_update_checkpoint` | Executor reports checkpoint progress | `node_id, checkpoint_id, status` |
| `graph_update_execution_report` | Executor submits the handoff report | `node_id, summary, artifacts, blockers, notes` |
| `graph_delete_node` | Soft-delete a node | `id` |
| `graph_get_graph` | Get the full topology (nodes + edges + adjacency) | — |
| `graph_traverse` | Traverse neighbors from a node | `node_id, direction, max_depth` |
| `graph_search` | Search nodes by criteria | `query, status, type, assigned_to` |

Params are validated by zod schemas: missing params / invalid enums return protocol error `-32602` (`isError=true`); invalid state-machine transitions return explicit errors too — never silent failure.

### MCP Configuration

**Claude Code (`claude.json`):**

```json
{
  "mcpServers": {
    "super-plumber": {
      "command": "graph-mcp"
    }
  }
}
```

---

## Web UI (Svelte 5 + D3.js)

Run `graph serve` and open `http://localhost:8934`:

- **Force-directed graph**: zoom / pan / auto-fit, colored by status
- **Edge type visualization**: distinct color per edge type, hover highlight
- **Flow dots**: animated dots on downstream edges of `running` nodes
- **Checkpoint progress bar**: sub-step completion under each node
- **Assignee label**: shows `assigned_to` next to `running` nodes
- **WebSocket incremental push**: node changes push `node:updated` deltas (not full graph); automatic HTTP fallback when the socket drops

---

## Storage Layout

```text
.graph/
├── graph.yaml         # Graph definition (entry/exit/root context + nodes/edges reference list)
├── nodes/*.yaml       # Node files (the "tarball": plan / checkpoints / execution_report)
├── edges/*.yaml       # Edge files
├── snapshots/         # Version snapshots (reserved)
└── index/             # Derived indexes (rebuildable, not versioned)
    ├── graph.json
    └── meta.json
```

**Design principles:**

- **Git is the single source of truth** — all data lives as files in the Git repo; `index/` can be deleted and rebuilt
- **File-as-node** — each node is one YAML file
- **Structure over prose** — YAML schema constraints, no free-form Markdown
- **Pure file system** — no database; soft-delete keeps `.deleted.yaml` history

---

## Development

```bash
# Install dependencies
npm install

# Build (backend + frontend)
npm run build && cd web-ui && npm run build

# Test
npm test

# Dev mode
npm run dev
```

---

## Subagents (Pi Agent)

Two project-local subagents live in `.pi/agents/`:

| Agent | Role | Responsibilities |
|-------|------|------------------|
| `super-mario` | Topology controller | Node lifecycle adjudication (checkpoint aggregation + output spot-checks), retry management, status monitoring, progress sync checks |
| `graph-designer` | Topology designer | Decompose requirements into a structured graph topology and author each node's plan and definition_of_done |

Plus the `topo-graph` skill (`.pi/skills/topo-graph/`) documenting the MCP tool table and the executor collaboration protocol (claim → report checkpoint progress → submit handoff report → Super Mario adjudicates).

---

## Project Status

```text
Tests:  78/78 ✅  |  CLI: 11 commands  |  MCP: 9 tools  |  Web UI: Svelte 5 + D3.js
```

## License

MIT
