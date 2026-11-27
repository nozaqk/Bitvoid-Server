#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOTS = ["src", "bin", "scripts", "test"];
const files = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
    } else if (entry.endsWith(".js") || entry.endsWith(".mjs")) {
      files.push(full);
    }
  }
}

for (const root of ROOTS) {
  walk(resolve(process.cwd(), root));
}

if (files.length === 0) {
  console.error("No JavaScript files found to check.");
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const res = spawnSync(process.execPath, ["--check", file], { stdio: "pipe" });
  if (res.status !== 0) {
    failures += 1;
    console.error(`Syntax error in ${file}:`);
    process.stderr.write(res.stderr);
  }
}

if (failures > 0) {
  console.error(`Syntax check failed in ${failures}/${files.length} file(s).`);
  process.exit(1);
}

console.log(`Syntax check passed for ${files.length} JavaScript file(s).`);
