# 0.9.6 Release Evidence

Date: 2026-09-05

## Version and package

- Package: `@lukawi/super-plumber@0.9.6`
- `package.json` and `package-lock.json` root metadata agree on `0.9.6`.
- Claude/Codex marketplace and plugin manifests agree on `0.9.6`.
- `npm pack --dry-run --json` produced `lukawi-super-plumber-0.9.6.tgz`, 565,824 bytes, 329 entries.

## 0.9.6 verification

- Root: 99 files / 858 tests, exit 0.
- UI: 12 files / 117 tests, typecheck 0 errors/0 warnings, build exit 0.
- Five repair chains: schema 14/200; snapshot 7/55; concurrency 7/59; index/cache 6/28; Web 4/23; all exit 0.
- Full Web fixture: 300 nodes, 299 edges, 600 source files; exit 0.
- Root typecheck/build, integration sync check, and docs export check: exit 0.
- MCP SDK stdio handshake: connected, 26 tools, `graph_list_graphs` not an error; current graph `roadmap-to-1-0-0`.

## Release actions

The human release checkpoint was approved before commit, tag, and npm publish. The release commit, `v0.9.6` tag, registry publication, and clean-environment installation regression are recorded in the release node execution report.
