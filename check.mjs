#!/usr/bin/env node
// Syntax-check all ES modules under js/. Runs `node --check` on each,
// aggregates results, exits non-zero if anything fails.
//
// Works via `node check.mjs` or `npm run check`.

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = readdirSync("js")
  .filter(f => f.endsWith(".js"))
  .sort()
  .map(f => `js/${f}`);

let failed = 0;
for (const path of files) {
  const r = spawnSync("node", ["--check", path], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (r.status === 0) {
    console.log(`  ✓ ${path}`);
  } else {
    failed++;
  }
}
process.exit(failed > 0 ? 1 : 0);
