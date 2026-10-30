#!/usr/bin/env node
// cradle — 決定論的な道具の入口。`node <this> <command> [args]`
//   spec-query | golden-check | lean-check | regen-impact | unslop | status | ddd-clean-check | doctor [--local] | refs <ID> | contract-skeleton <file> | hook
import { spawnSync } from "node:child_process";
const [cmd, ...args] = process.argv.slice(2);
const map = { "spec-query": "spec-query.mjs", "golden-check": "golden-check.mjs", "lean-check": "lean-check.mjs", "regen-impact": "regen-impact.mjs", unslop: "unslop-lint.mjs", status: "status.mjs", "ddd-clean-check": "ddd-clean-check.mjs", hook: "hook.mjs" };
// 使い方の一覧（map）に出ない入口
const unlisted = { doctor: "doctor.mjs", refs: "refs.mjs", "contract-skeleton": "contract-skeleton.mjs" };
const script = map[cmd] ?? unlisted[cmd];
if (!script) {
  console.log("usage: cradle <command> [args]\n  " + Object.keys(map).join("\n  "));
  process.exit(cmd ? 1 : 0);
}
const { cradleScript } = await import("./lib.mjs");
const r = spawnSync(process.execPath, [cradleScript(script), ...args], { stdio: "inherit" });
process.exit(r.status ?? 1);
