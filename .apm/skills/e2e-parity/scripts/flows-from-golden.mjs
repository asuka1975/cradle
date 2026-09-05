#!/usr/bin/env node
// flows-from-golden — golden の trace から E2E フローの台本（人物・手・期待される結果）を機械で起こす。
//   flows-from-golden [--out e2e/scenarios/from-golden.json] [--json]
// 台本は「誰が・何を・結果は通った／断られた・そのとき画面（views）に何が見えたか」の列。
// 画面の操作（どのボタン・どの欄）への写しは e2e 側の仕事で、ここでは決めない。
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { loadConfig, parseArgs, fail } from "../../cradle/scripts/lib.mjs";

const opts = parseArgs(process.argv.slice(2), { json: "bool" });
const cfg = loadConfig();
const goldenDir = join(cfg.root, cfg.lean.golden);
if (!existsSync(goldenDir)) fail(`golden がありません: ${goldenDir}`);

const flows = [];
for (const f of readdirSync(goldenDir).filter(f => f.endsWith("-flow.json")).sort()) {
  const name = f.replace(/-flow\.json$/, "");
  const trace = JSON.parse(readFileSync(join(goldenDir, f), "utf8")).ok?.trace ?? [];
  const req = existsSync(join(goldenDir, `${name}.request.json`)) ? JSON.parse(readFileSync(join(goldenDir, `${name}.request.json`), "utf8")) : null;
  const personas = [...new Set(trace.map(t => JSON.stringify(t.actor)))].map(s => JSON.parse(s));
  const steps = trace.map((t, i) => {
    const cmd = t.command && typeof t.command === "object" ? Object.keys(t.command)[0] : String(t.command);
    const base = { n: i + 1, actor: t.actor, command: cmd, payload: t.command?.[cmd] };
    if (t.domainError !== undefined) return { ...base, outcome: "refused", refusal: t.domainError };
    if (t.error !== undefined) return { ...base, outcome: "protocol-error", error: t.error };
    const observe = {};
    for (const [k, v] of Object.entries(t.views ?? {})) observe[k] = v === null ? "absent" : Array.isArray(v) ? `${v.length} rows` : typeof v;
    return { ...base, outcome: "applied", observe };
  });
  flows.push({ id: name, scenario: req?.init?.scenario ?? req?.flow?.scenario ?? null, viewer: req?.flow?.viewer ?? null, today: req?.flow?.today ?? null, personas, steps });
}

const out = { generatedFrom: cfg.lean.golden, flows };
if (opts.out) { mkdirSync(dirname(join(cfg.root, opts.out)), { recursive: true }); writeFileSync(join(cfg.root, opts.out), JSON.stringify(out, null, 2) + "\n"); console.log(`wrote ${opts.out} (${flows.length} flows)`); }
else if (opts.json) console.log(JSON.stringify(out, null, 2));
else for (const fl of flows) {
  console.log(`# ${fl.id}  scenario=${fl.scenario} viewer=${JSON.stringify(fl.viewer)} today=${fl.today}`);
  for (const s of fl.steps) console.log(`  ${s.n}. ${s.command} by ${JSON.stringify(s.actor)} → ${s.outcome}${s.refusal !== undefined ? ` (${JSON.stringify(s.refusal)})` : ""}${s.observe ? "  " + Object.entries(s.observe).map(([k, v]) => `${k}:${v}`).join(" ") : ""}`);
}
