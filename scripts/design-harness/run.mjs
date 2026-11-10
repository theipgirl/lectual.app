#!/usr/bin/env node
// One command: render (vitest, harness config) + shoot (Playwright) + compare (PIL).
//   node scripts/design-harness/run.mjs [screenId ...]
// Needs a compiled CSS set from `pnpm build` (.next/static/chunks/*.css). Env: DESIGN_SHOTS (design board PNG folder).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const ids = process.argv.slice(2);

function step(name, cmd, args, env = {}) {
  console.log(`\n== ${name}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`${name} failed`);
    process.exit(r.status ?? 1);
  }
}

step("render", "pnpm", ["exec", "vitest", "run", "-c", "scripts/design-harness/vitest.config.mts"], { HARNESS_SCREENS: ids.join(",") });
step("shoot", "node", ["scripts/design-harness/shoot.mjs", ...ids]);
step("compare", "python3", ["-I", "scripts/design-harness/compare.py", ...ids]);
console.log(`\nDone. Look at scripts/design-harness/out/pairs-small/ (and pairs-stack/ for desktop pages).`);
