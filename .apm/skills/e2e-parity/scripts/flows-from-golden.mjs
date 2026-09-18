#!/usr/bin/env node
// flows-from-golden — golden の trace から E2E フローの台本（人物・手・期待される結果）を機械で起こす。
//   flows-from-golden [--out e2e/scenarios/from-golden.json] [--json]
//   flows-from-golden --check [<台本の置き場>]
// 台本は「誰が・何を・結果は通った／断られた／障害で止まった・そのとき画面（views）に何が見えたか」の列。
// 手は利用者の操作（kind command: 構成子名と actor）か内部入力（kind observation: 構成子名。当事者は無い）。
// 外部能力の経路で採った流れ（external）は環境（environment: { name, script }。name は sidecar の環境名で script を直に渡した golden では null、
// script は CLI の応答の env のもの — 駆動側が stopAt の golden で「期待したのに呼ばれなかった」尾を知るのに要る）と、
// 手ごとに外部能力の往復（interactions）、入力が指名した障害契約（fault）、障害で止まった契約（contract）を添える。
// 画面の操作（どのボタン・どの欄）への写しは e2e 側の仕事で、ここでは決めない。
// --check は golden の各流れの手の列（kind と構成子名・command なら actor・outcome。台本に payload があればそれも）が、
// 置き場の台本（from-golden.json と同じ steps の形）に同じ順であるかを見る。
// 台本 1 本が対応する流れは 1 本。置き場の既定は cradle.json の e2e.scenarios。対応の無い流れがあれば 1 で終わる。
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { loadConfig, parseArgs, fail, e2eCoverage, outcomeOf, readSidecar, isExternalGolden, goldenEnvironment, traceInputOf } from "../../cradle/scripts/lib.mjs";

const opts = parseArgs(process.argv.slice(2), { json: "bool", check: "bool" });
const cfg = loadConfig();
const goldenDir = join(cfg.root, cfg.lean.golden);
if (!existsSync(goldenDir)) fail(`golden がありません: ${goldenDir}`);

const stepLine = (s) => s.kind === "observation" ? `observation ${s.observation} → ${s.outcome}` : `${s.command} by ${JSON.stringify(s.actor)} → ${s.outcome}`;
const environmentLabel = (e) => e ? `${e.name ?? "-"} (script ${e.script.length} 件)` : "-";

if (opts.check) {
  const c = e2eCoverage(cfg, opts._[0] ?? cfg.e2e.scenarios);
  if (opts.json) console.log(JSON.stringify(c, null, 2));
  else {
    console.log(`golden の流れ ${c.golden.length} 本のうち台本が対応しているのは ${c.covered.length} 本（台本 ${c.scripts} 本: ${c.place}）`);
    for (const id of c.uncovered) {
      const fl = c.flows.find(f => f.id === id);
      console.log(`  対応する台本が無い: ${id}${fl.external ? `（external, environment=${environmentLabel(fl.environment)}）` : ""}`);
      for (const [i, s] of fl.steps.entries()) console.log(`    ${i + 1}. ${stepLine(s)}`);
    }
  }
  process.exit(c.uncovered.length ? 1 : 0);
}

const flows = [];
for (const f of readdirSync(goldenDir).filter(f => f.endsWith("-flow.json")).sort()) {
  const name = f.replace(/-flow\.json$/, "");
  const trace = JSON.parse(readFileSync(join(goldenDir, f), "utf8")).ok?.trace ?? [];
  let req = null, external = false;
  try { req = readSidecar(goldenDir, name); external = isExternalGolden(goldenDir, name); } catch (e) { fail(e.message); }
  // 人物は利用者の操作の当事者だけ — 内部入力に当事者は無い
  const personas = [...new Set(trace.filter(t => traceInputOf(t).kind === "command" && t.actor !== undefined).map(t => JSON.stringify(t.actor)))].map(s => JSON.parse(s));
  const steps = trace.map((t, i) => {
    const { kind, name: input, payload } = traceInputOf(t);
    const base = { n: i + 1, kind, [kind]: input, ...(kind === "command" ? { actor: t.actor } : {}), payload, outcome: typeof t.result === "string" ? t.result : outcomeOf(t) };
    if (external) base.interactions = t.interactions ?? [];
    // 指名した障害契約の名前は trace の写し（無ければ sidecar の入力から）
    const nominated = typeof t.fault === "string" ? t.fault : req?.flow?.inputs?.[i]?.fault;
    if (typeof nominated === "string") base.fault = nominated;
    if (t.domainError !== undefined) return { ...base, refusal: t.domainError };
    if (t.error !== undefined) return { ...base, error: t.error };
    const observe = {};
    for (const [k, v] of Object.entries(t.views ?? {})) observe[k] = v === null ? "absent" : Array.isArray(v) ? `${v.length} rows` : typeof v;
    if (t.result === "fault") return { ...base, contract: t.faultContract?.name ?? null, observe };
    return { ...base, observe };
  });
  flows.push({ id: name, external, environment: goldenEnvironment(goldenDir, name, req), scenario: req?.init?.scenario ?? req?.flow?.scenario ?? null, viewer: req?.flow?.viewer ?? null, today: req?.flow?.today ?? null, personas, steps });
}

const out = { generatedFrom: cfg.lean.golden, flows };
if (opts.out) { mkdirSync(dirname(join(cfg.root, opts.out)), { recursive: true }); writeFileSync(join(cfg.root, opts.out), JSON.stringify(out, null, 2) + "\n"); console.log(`wrote ${opts.out} (${flows.length} flows)`); }
else if (opts.json) console.log(JSON.stringify(out, null, 2));
else for (const fl of flows) {
  console.log(`# ${fl.id}  scenario=${fl.scenario} viewer=${JSON.stringify(fl.viewer)} today=${fl.today}${fl.external ? ` external environment=${environmentLabel(fl.environment)}` : ""}`);
  for (const s of fl.steps) console.log(`  ${s.n}. ${stepLine(s)}${s.refusal !== undefined ? ` (${JSON.stringify(s.refusal)})` : ""}${s.contract ? ` (${s.contract})` : ""}${s.observe ? "  " + Object.entries(s.observe).map(([k, v]) => `${k}:${v}`).join(" ") : ""}`);
}
