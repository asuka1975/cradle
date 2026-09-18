#!/usr/bin/env node
// flows-from-golden — golden の trace から E2E フローの台本（人物・手・期待される結果）を機械で起こす。
//   flows-from-golden [--out e2e/scenarios/from-golden.json] [--json]
//   flows-from-golden --check [<台本の置き場>]
// 台本は「誰が・何を・結果は通った／断られた・そのとき画面（views）に何が見えたか」の列。
// 画面の操作（どのボタン・どの欄）への写しは e2e 側の仕事で、ここでは決めない。
// --check は golden の各流れの手の列（command・actor・outcome。台本に payload があればそれも）が、置き場の台本（from-golden.json と同じ steps の形）に同じ順であるかを見る。
// 台本 1 本が対応する流れは 1 本。置き場の既定は cradle.json の e2e.scenarios。対応の無い流れがあれば 1 で終わる。
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { loadConfig, parseArgs, fail, e2eCoverage, commandNameOf, outcomeOf } from "../../cradle/scripts/lib.mjs";

const opts = parseArgs(process.argv.slice(2), { json: "bool", check: "bool" });
const cfg = loadConfig();
const goldenDir = join(cfg.root, cfg.lean.golden);
if (!existsSync(goldenDir)) fail(`golden がありません: ${goldenDir}`);

if (opts.check) {
  const c = e2eCoverage(cfg, opts._[0] ?? cfg.e2e.scenarios);
  if (opts.json) console.log(JSON.stringify(c, null, 2));
  else {
    console.log(`golden の流れ ${c.golden.length} 本のうち台本が対応しているのは ${c.covered.length} 本（台本 ${c.scripts} 本: ${c.place}）`);
    for (const id of c.uncovered) {
      const fl = c.flows.find(f => f.id === id);
      console.log(`  対応する台本が無い: ${id}`);
      for (const [i, s] of fl.steps.entries()) console.log(`    ${i + 1}. ${s.command} by ${JSON.stringify(s.actor)} → ${s.outcome}`);
    }
  }
  process.exit(c.uncovered.length ? 1 : 0);
}

const flows = [];
for (const f of readdirSync(goldenDir).filter(f => f.endsWith("-flow.json")).sort()) {
  const name = f.replace(/-flow\.json$/, "");
  const trace = JSON.parse(readFileSync(join(goldenDir, f), "utf8")).ok?.trace ?? [];
  const req = existsSync(join(goldenDir, `${name}.request.json`)) ? JSON.parse(readFileSync(join(goldenDir, `${name}.request.json`), "utf8")) : null;
  const personas = [...new Set(trace.map(t => JSON.stringify(t.actor)))].map(s => JSON.parse(s));
  const steps = trace.map((t, i) => {
    const cmd = commandNameOf(t.command);
    const base = { n: i + 1, actor: t.actor, command: cmd, payload: t.command?.[cmd], outcome: outcomeOf(t) };
    if (t.domainError !== undefined) return { ...base, refusal: t.domainError };
    if (t.error !== undefined) return { ...base, error: t.error };
    const observe = {};
    for (const [k, v] of Object.entries(t.views ?? {})) observe[k] = v === null ? "absent" : Array.isArray(v) ? `${v.length} rows` : typeof v;
    return { ...base, observe };
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
