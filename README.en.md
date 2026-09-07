# Super Plumber

> Turn complex software delivery into a workflow graph you can design, execute, review, and trace.

[![npm version](https://img.shields.io/npm/v/@lukawi/super-plumber)](https://www.npmjs.com/package/@lukawi/super-plumber)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-LUKAWI%2Fsuper--plumber-black)](https://github.com/LUKAWI/super-plumber)

Super Plumber is a workflow orchestration tool for developers, automation systems, and coding agents. It turns a task list into a graph with explicit dependencies, execution states, acceptance criteria, and handoff records.

Use the CLI to manage a graph directly. Connect the MCP server when an agent needs to read the graph, claim work, and report progress. Open the read-only Web UI when you want to keep an eye on a long-running workflow. The core data is stored as YAML files, so Git can review, branch, and restore it like any other project artifact.

中文文档：[README.md](README.md) · npm：[@lukawi/super-plumber](https://www.npmjs.com/package/@lukawi/super-plumber) · Operations manual：[integrations/src/manual.md](integrations/src/manual.md)

## What problem does it solve?

Development work often loses information at the handoff points:

- Which task must happen first, and which tasks can run in parallel?
- What evidence is required before a task counts as complete?
- Can another person or agent continue after a handoff?
- Where are the decisions, interface contracts, and failure reasons recorded?
- Is a task blocked by a dependency, a missing executor, or a plan that needs to change?

Super Plumber keeps those answers in one validated structure:

~~~text
Requirement and acceptance target
              │
              ▼
entry → clarify scope → build → test and verify → exit
             │              │
             └─ depends_on / validates / fan_out / fan_in
                              │
                     handoff + audit event + Git diff
~~~

The graph is more than another way to draw a task list. Dependencies affect scheduling and gates, completion criteria guide acceptance, and state changes leave an audit trail.

## What can you use it for?

| Situation | How Super Plumber helps |
| --- | --- |
| Building a feature | Split a request into clarification, implementation, tests, and release steps with explicit dependencies. |
| Refactoring or migration | Express migration order, add verification nodes, and keep rollback evidence close to the plan. |
| Multiple people or agents | Give each person an independent node and a handoff with real artifact paths. |
| Research before implementation | Separate research, decisions, and build work; use a program workflow when an unknown can change the plan. |
| Release and acceptance | Record the path from running code to an accepted deliverable with checkpoints, verdicts, and exported documents. |
| Long-running work | Use the Web UI to watch ready, running, blocked, and failed nodes, then inspect a node or snapshot diff. |

For a one-line configuration change or a quick question, a full graph is usually unnecessary.

## Highlights

| Highlight | What you get |
| --- | --- |
| Graph-driven ordering | Dependencies participate in scheduling instead of living only in chat history. |
| Evidence-based completion | Every node can carry acceptance criteria, checkpoints, and a handoff that others can inspect. |
| Built for handoffs and parallel work | Executors claim independent nodes and leave real artifact paths for the next person. |
| Three ways to access the same graph | The CLI is for people, MCP is for agents, and the Web UI is for read-only observation. |
| File-first storage | YAML is readable, diffable, and Git-friendly without a database or hosted account. |
| Work and domain knowledge together | Contexts, glossaries, and ADRs stay connected to the tasks they govern. |

## Core concepts

### A graph

Each graph has one entry and one exit:

- entry describes the request;
- exit describes the deliverable and its acceptance criteria;
- nodes represent executable work or domain knowledge;
- edges express dependencies, validation, parallel work, fallback, or domain relationships.

Graph data lives under .graph/. One workspace can contain several named graphs, such as feature-auth, data-migration, and release-1-0.

### A node

A task node usually contains:

| Field | Purpose |
| --- | --- |
| id / label | A stable identifier and a readable name. |
| plan | What to do, where inputs come from, and where the result goes. |
| definition_of_done | Observable criteria that someone else can verify. |
| checkpoints | Steps reported while the node is being executed. |
| execution_report | Handoff summary, artifact paths, blockers, and acceptance notes. |
| status | A state-machine status such as pending, ready, running, or passed. |

Think of a node as a small delivery package. The next executor does not need to reconstruct context from a chat transcript.

### Edges

These edges participate in topological ordering and ready gates:

| Edge | Meaning |
| --- | --- |
| depends_on | B waits for A to finish. |
| validates | One node verifies the result of another. |
| fan_out | Several downstream nodes may run after one node finishes. |
| fan_in | A convergence node waits for several upstream nodes. |

These edges describe runtime or domain relationships:

| Edge | Meaning |
| --- | --- |
| shares_context | Shares context without creating a ready gate. |
| fallback | Records an alternative route when a source node exhausts its retries. |
| iterates | Marks work that needs repeated improvement. |
| decides | Connects an ADR to the work or domain vertices it governs. |
| relates | Connects two bounded contexts. |

### The state machine

The usual task path is:

~~~text
pending → ready → running → passed
                         └→ failed → pending   (retry)
running → pending                              (reclaim a dead claim)
any state → cancelled
~~~

Three rules matter in daily use:

1. A node must satisfy all gated predecessors before it becomes ready.
2. Retries after failed are limited by max_attempts.
3. A running node cannot be marked passed with a claim alone: it needs a non-empty execution report, completed checkpoints, and no failed verdict.

Context vertices are stateless domain objects. ADR vertices use the proposed → accepted → superseded lifecycle. Accepting or superseding an ADR is a governance decision, not an implicit execution step.

## Quick start

### 1. Install

You need Node.js 20 or newer and npm.

~~~bash
npm install -g @lukawi/super-plumber
graph --version
~~~

To run the code in this repository:

~~~bash
git clone https://github.com/LUKAWI/super-plumber
cd super-plumber
npm ci
npm run build
npm --prefix web-ui ci
npm --prefix web-ui run build
npm link
~~~

### 2. Create a graph

This example plans a CSV export for an existing report:

~~~bash
mkdir csv-export-demo
cd csv-export-demo

graph init csv-export -l "Report CSV export"
graph update-graph \
  --entry-desc "Add a downloadable CSV export for reports" \
  --exit-desc "Users can download correctly encoded CSV files with complete test evidence" \
  --add-criteria "Exported columns and filters match the report" \
  --add-criteria "Browser download and API usage are covered by tests"
~~~

### 3. Add executable nodes

~~~bash
graph create-node -i clarify -l "Clarify export contract" -t task --level 1 \
  --plan-desc "Decide column order, encoding, date format, and empty-value rules" \
  --dod "Export fields and an example file are agreed"

graph create-node -i implement -l "Implement CSV export" -t task --level 1 \
  --plan-desc "Implement the server export and download response" \
  --dod "The API returns a downloadable CSV" \
  --dod "Invalid input has a clear response"

graph create-node -i verify -l "Verify the export" -t task --level 1 \
  --plan-desc "Cover fields, encoding, filtering, and download behavior" \
  --dod "Automated tests pass" \
  --dod "A real export file can be inspected"

graph add-edge -i e1 -s clarify -t implement --type depends_on
graph add-edge -i e2 -s implement -t verify --type depends_on
~~~

### 4. Validate and find the next step

~~~bash
graph validate
graph status
graph next
~~~

validate checks the schema, node and edge references, topology, and cycles. next groups claimable work, dependency waits, running nodes, and possibly stale nodes. Use JSON when another tool will consume the result:

~~~bash
graph next --json
~~~

Newly created nodes commonly appear in ready_eligible. This means their predecessor gates are satisfied and they can enter the ready state, but no executor has claimed them yet:

~~~bash
graph update-status -i clarify -s ready
~~~

An executor can then atomically claim the node through MCP or the execution script.

### 5. Open the visual view

~~~bash
graph serve
~~~

The default address is http://localhost:8934. For CI, remote terminals, or headless environments:

~~~bash
graph serve --no-open
~~~

## How does a delivery move through the graph?

After the design and acceptance criteria are clear, execution follows this sequence.

### Claim a node

Find a ready node with next, then claim it atomically. Only one executor wins a concurrent claim:

~~~text
graph_update_node_status({
  id: "clarify",
  status: "running",
  claim_by: "backend-agent"
})
~~~

In an environment with the bundled execution scripts:

~~~bash
node .pi/skills/plumber-execute/scripts/sp.mjs claim clarify backend-agent
~~~

### Report checkpoints

Report each completed step when a node has multiple checkpoints:

~~~text
graph_update_checkpoint({
  node_id: "implement",
  checkpoint_id: "cp1",
  status: "passed"
})
~~~

### Submit a handoff

Point the report at real artifacts instead of only writing “done”:

~~~text
graph_update_execution_report({
  node_id: "implement",
  summary: "CSV export is implemented and connected to report filters",
  artifacts: [
    "src/export/csv.ts",
    "tests/export/csv.test.ts",
    "tmp/examples/report.csv"
  ],
  blockers: [],
  notes: "UTF-8 with BOM; dates use ISO format"
})
~~~

Without an MCP client, the script can submit the same handoff:

~~~bash
node .pi/skills/plumber-execute/scripts/sp.mjs report \
  implement \
  "CSV export is implemented" \
  "src/export/csv.ts,tests/export/csv.test.ts" \
  "" \
  "UTF-8 with BOM; dates use ISO format"
~~~

### Accept the result

The executor submits the report. A reviewer or human then checks the evidence against the node's definition of done, records a verdict, and marks the node passed. The graph rejects a passed transition when the report is missing, checkpoints are incomplete, or a failed verdict exists.

For example, after acceptance:

~~~bash
graph verdict -i implement --verdict passed --note "CSV file and automated tests were checked"
graph update-status -i implement -s passed
~~~

## Choose a workflow class

Ask these two questions:

1. Is there an unknown that could change the scope, main approach, or critical dependency?
2. If not, can one session finish and accept the work?

| Class | Use it when | Typical flow |
| --- | --- | --- |
| quick | The goal is clear and one session can finish it | A small graph or one node with a lightweight review. |
| standard | The goal is clear but needs several nodes, sessions, or executors | Full design, review, execution, and acceptance flow. |
| program | A critical unknown can invalidate the current plan | Record the unknown and graduation evidence, then research until a credible plan exists. |

Set the class while initializing a graph:

~~~bash
graph init csv-export -l "Report CSV export" --class standard
~~~

When installed as a plugin, /plumber only routes the request: whether to use Super Plumber, which class and graph to use, and which entry point comes next. It does not create a graph, claim a node, or start execution. Use /plumber-design, /plumber-execute, or /plumber-join for those direct flows.

## Multiple graphs in one workspace

Keep several workstreams in one project:

~~~bash
graph init feature-auth -l "Authentication"
graph init data-migration -l "Data migration"
graph list
graph switch feature-auth
graph status
~~~

Target a graph for one command:

~~~bash
graph status --graph data-migration
graph next --graph feature-auth --json
~~~

Graph selection follows explicit --graph, SUPER_PLUMBER_GRAPH, the workspace active file, and default. An invalid graph name is reported with the available graphs instead of silently selecting another one.

## Web UI: a read-only observatory

graph serve provides a local Web UI backed by the same .graph data. It does not write execution state, so it is useful as a long-running progress view:

- filter by status, level, or search term;
- switch between workflow and domain views;
- inspect nodes, edges, contexts, and ADRs;
- see running work and its dependencies;
- compare snapshots and identify additions, removals, and changes;
- reconnect after a dropped connection and navigate with the keyboard.

Canvas colors represent state. State changes still happen through the CLI or MCP, so a teammate can watch progress without receiving permission to modify the graph.

## MCP integration

Start the bundled MCP server:

~~~bash
graph-mcp
~~~

Generic MCP configuration:

~~~json
{
  "mcpServers": {
    "super-plumber": {
      "command": "npx",
      "args": ["-y", "@lukawi/super-plumber", "graph-mcp"]
    }
  }
}
~~~

To use the current source checkout:

~~~json
{
  "mcpServers": {
    "super-plumber": {
      "command": "node",
      "args": ["/absolute/path/to/super-plumber/dist/mcp/server.js"]
    }
  }
}
~~~

The MCP surface covers:

| Area | Typical operations |
| --- | --- |
| Read and schedule | Read nodes, traverse dependencies, search, inspect next, and survey multiple graphs. |
| Design | Create graphs, nodes, edges, entry/exit criteria, and ADRs. |
| Execute | Atomically claim work, report checkpoints and handoffs, and reclaim dead claims. |
| Accept and version | Record verdicts, validate, inspect events, and use snapshots, diff, and rollback. |

Read endpoints support compact and paginated responses for large graphs. Parameters are schema-validated and errors are returned in a form clients can inspect.

## Agent integrations

The same graph data can be used through several interfaces:

| Interface | Use it for |
| --- | --- |
| CLI | Human design, inspection, and maintenance. |
| MCP | Let Claude, Codex, OpenCode, and other MCP clients work through graph tools. |
| pi | Copy the repository .pi/ directory into a project and use the bundled skills and sp.mjs. |
| Claude Code / ZCode | Install integrations/plugin/ and use the design, execute, join, and review skills. |
| Codex | Install the official plugin; it includes graph-mcp and six skills. |

Claude Code plugin installation:

~~~text
/plugin marketplace add lukawi/super-plumber
~~~

Codex plugin installation:

~~~bash
codex plugin marketplace add lukawi/super-plumber
codex plugin add super-plumber --marketplace lukawi-super-plumber
~~~

The main entry points are:

- plumber-design: turn a request into a graph with dependencies and acceptance criteria, then request review;
- plumber-execute: claim nodes in dependency order and submit checkpoints and handoffs;
- plumber-join: enter an existing graph when you need context before execution;
- plumber: provide read-only routing advice;
- plumber-tdd: define a test seam and run a red-green cycle when a node requires test-first work;
- plumber-review: have a second reviewer inspect a node's deliverables.

## Domain modeling with contexts and ADRs

The graph can also store domain knowledge:

- a bounded context records a boundary and glossary and can be exported as documentation;
- an ADR records a decision, background, alternatives, rationale, and consequences.

Create an ADR:

~~~bash
graph adr create -t "Use UTF-8 with BOM for exports" \
  -d "Generate UTF-8 CSV files with a BOM"
~~~

Export domain documents:

~~~bash
graph export --docs
~~~

In a multi-graph workspace, the export creates docs/<graph-name>/adr, contexts, CONTEXT-MAP.md, and DECISIONS.md. The graph is the source of truth; Markdown is the readable, reviewable view.

## Git-friendly file storage

Graph data is made of ordinary files:

~~~text
.graph/
├── active                 # workspace default graph
├── workspace-events.jsonl
└── csv-export/
    ├── graph.yaml
    ├── nodes/*.yaml
    ├── edges/*.yaml
    ├── events.jsonl
    ├── snapshots/
    └── index/
~~~

This lets you:

- review graph changes with git diff;
- use branches for alternative plans;
- compare or restore design with snapshot, diff, and rollback;
- review the delivery plan beside the code in a pull request.

index/ contains rebuildable derived data. graph.yaml, node and edge YAML files, and event logs are the important records. Whether to commit .graph depends on your team's audit and recovery requirements.

## CLI reference

Every command has --help. The complete command surface is grouped below:

| Area | Commands |
| --- | --- |
| Workspace and graphs | init, switch, list, rename-graph, delete-graph, serve |
| Design | create-node, get-node, update-node, delete-node, add-edge, delete-edge, update-graph, approve, graduate-fog, adr |
| Execution | next, survey, update-status, reclaim, verdict |
| Inspection and versioning | status, validate, rebuild, export, snapshot, snapshots, diff, rollback, events |

Useful commands:

~~~bash
graph create-node --help
graph get-node -i implement --json
graph status --json
graph events --node implement --last 20
graph snapshot -m "CSV export before release"
graph diff --json
~~~

## Troubleshooting

### Why does graph init require a graph name?

The name should describe the content or scope, such as feature-auth or billing-migration. Named graphs let one workspace hold several workstreams and are easier to find than an unnamed default.

### Why can I not move pending directly to running?

running means that an executor has claimed the node. The ready step checks predecessor gates, and the running step records the executor and start time.

### Why was passed rejected?

Check that the node has a non-empty execution_report, every checkpoint is passed or skipped, and no failed verdict is present. Submit the handoff before completing the state transition.

### MCP still behaves like the previous version

The MCP server is a long-running process. Restart the client or reconnect the server after upgrading the npm package.

### The Web UI is empty

Make sure the current directory or MCP workspace root contains .graph, then confirm the selected graph:

~~~bash
graph list
graph status --graph <name>
~~~

### validate reports warnings

Warnings and errors have different meanings. Run graph validate --json and inspect the referenced file and node. Broken references, invalid endpoints, and cycles usually need repair; duplicate glossary terms or missing contracts may require a design decision.

## Development and testing

~~~bash
git clone https://github.com/LUKAWI/super-plumber
cd super-plumber
npm ci
npm run typecheck
npm run build
npm test

npm --prefix web-ui ci
npm --prefix web-ui run typecheck
npm --prefix web-ui run build
npm --prefix web-ui test
~~~

The canonical integration assets live under integrations/src/. After changing a skill, script, command, or manual:

~~~bash
node scripts/sync-integrations.mjs
node scripts/sync-integrations.mjs --check
node dist/cli/index.js export --docs --check
~~~

## Project status

The current release is **1.0.0 stable**. The MCP/CLI v1 semantics are frozen; the source includes the CLI, MCP server, Web UI, YAML storage, multiple graphs per workspace, domain contexts and ADRs, snapshots, and audit events.

~~~text
Tests: 895 (backend) + 122 (frontend) ✅ | CLI: 30 commands | MCP: 27 tools | State machine: 7 states + ready gate + max_attempts + passed hard gate | Edge types: 9 | Storage: YAML + Git
~~~

- GitHub: [LUKAWI/super-plumber](https://github.com/LUKAWI/super-plumber)
- npm: [@lukawi/super-plumber](https://www.npmjs.com/package/@lukawi/super-plumber)
- Operations manual: [integrations/src/manual.md](integrations/src/manual.md)
- Domain documentation: [docs/roadmap-to-1-0-0/](docs/roadmap-to-1-0-0/)

## License

MIT © 2026 Super Plumber contributors
