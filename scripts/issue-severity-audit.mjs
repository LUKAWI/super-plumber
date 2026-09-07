#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const issueLog = path.join(root, "docs", "issue-log.md");
const lines = fs.readFileSync(issueLog, "utf8").split(/\r?\n/);

// 1.0.0 release mapping: the existing issue-log urgency is the canonical
// severity source; high is S1, medium is S2, and low is S3. S0 has no
// production entry in this ledger. Only the main six-column issue table is
// audited; later historical matrices are evidence, not a second ledger.
const severity = { "高": "S1", "中": "S2", "低": "S3" };
const terminal = /^(?:✅|➡️)/u;
const rows = lines
  .filter((line) => /^\| IL-\d+\s*\|/u.test(line))
  .map((line) => line.split("|").map((cell) => cell.trim()))
  .filter((cells) => cells.length === 8)
  .map((cells) => ({
    id: cells[1],
    urgency: cells[4],
    status: cells[6],
    level: Object.entries(severity).find(([label]) => cells[4].startsWith(label))?.[1] ?? "unclassified",
  }));

const open = rows.filter((row) => !terminal.test(row.status));
const s0s1Open = open.filter((row) => row.level === "S0" || row.level === "S1");
const result = {
  source: path.relative(root, issueLog).replaceAll(path.sep, "/"),
  audited_rows: rows.length,
  open_rows: open.length,
  s0_s1_open: s0s1Open,
  ok: s0s1Open.length === 0,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
