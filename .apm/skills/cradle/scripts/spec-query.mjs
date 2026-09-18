#!/usr/bin/env node
// spec-query — Lean 実行可能仕様への決定論的な問い合わせ。
// 仕様に関する問いは推測で答えず、この道具で Lean を動かした結果を引用する。
//
//   spec-query meta                               シナリオ・環境・コマンド・内部入力（観測）・Port・失敗語彙・画面の口・external の版を JSON で
//   spec-query scenarios | environments           出発点（scenarioByName の腕）と名前付きの環境（environmentByName の腕）を、名前の配列で
//   spec-query commands | errors | outlets（画面の口） | schemas（コマンドごとの入力の形）
//   spec-query print <Name>...                    `lake env lean` の #print（型・構成子・フィールド）
//   spec-query init  --scenario S [--viewer J] [--actor J] [--today D]
//   spec-query run   --scenario S --commands J|@file [--actor J] [--viewer J] [--today D] [--full]
//   spec-query step  --state @file --command J --actor J [--viewer J] [--today D]
//   spec-query views --state @file --viewer J [--today D]
//     init / run / step / views は旧経路（cmd init / flow / step / views）のまま。環境を持たないので、Port を使う手（外部能力の往復が要る手）は
//     旧経路では通らず、spec-query external で打つ
//   spec-query external <action> …              外部能力と内部入力を扱う経路（cmd external、version 1）。action ごとの選択肢は実行器の許可欄と同じ:
//     init        --scenario S [--environment N | --env @file]      環境は名前か script そのもののどちらか一方（両方は不正。どちらも無ければ空の環境）
//     step        --state @file --env @file --input J|@file        input は {"command":…,"actor":…} か {"observation":…}（障害の指名は "fault"）
//     views       --state @file
//     flow | dump --scenario S --inputs J|@file [--environment N | --env @file] [--stop-at n]
//     共通        [--viewer J] [--actor J] [--today D] [--full]
//     env は init の応答の env（script と cursor）をそのまま渡す。--full 無しなら手ごとに入力の名前・result・環境の cursor を 1 行で出す
//   spec-query raw   @request.json | -            プロトコルそのままの素通し
//   共通: --build always|auto|never（既定 auto = バイナリが無ければ lake build）
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, callLean, leanEval, parseArgs, jsonArg, fail, walk, traceInputOf, ports } from "./lib.mjs";
import { joinWrapped, payloadHeads, payloadTypeOf, schemasFrom } from "./schema.mjs";

const opts = parseArgs(process.argv.slice(2), { full: "bool", json: "bool" });
const [cmd, ...rest] = opts._;
const cfg = loadConfig();
const build = opts.build ?? "auto";

const printJson = (v) => process.stdout.write(JSON.stringify(v, null, 2) + "\n");

function scenarios() {
  const files = walk(cfg.lean.rootDir, { ext: [".lean"] });
  const names = new Set();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const m = text.match(/def\s+scenarioByName[\s\S]*?(?=\n\S|$)/);
    if (!m) continue;
    for (const c of m[0].matchAll(/\|\s*"([^"]+)"\s*=>\s*some/g)) names.add(c[1]);
  }
  return [...names];
}

/** 名前付きの環境（外部能力の script）: Runtime/Scenarios.lean の environmentByName の腕。持たないプロジェクトでは空。 */
function environments() {
  const file = join(cfg.lean.modelDir, "Runtime", "Scenarios.lean");
  if (!existsSync(file)) return [];
  const m = readFileSync(file, "utf8").match(/def\s+environmentByName[\s\S]*?(?=\n\S|$)/);
  if (!m) return [];
  const names = new Set();
  for (const c of m[0].matchAll(/\|\s*"([^"]+)"\s*=>\s*some/g)) names.add(c[1]);
  return [...names];
}

/** 外部能力の経路（cmd external）の版。CLI に views を 1 回流して決める（ファイルの有無では決めない）—
    旧実行器は未知の cmd として拒否し（null）、新しい実行器は state が無いというプロトコルエラーで応じる（版 1 を持つ）。 */
const EXTERNAL_VERSION = 1;
const EXTERNAL_ACTIONS = ["init", "step", "views", "flow", "dump"];
async function externalProtocol() {
  const res = await callLean(cfg, { cmd: "external", version: EXTERNAL_VERSION, action: "views" }, { build });
  return typeof res?.error === "string" && /unknown cmd/.test(res.error) ? null : { version: EXTERNAL_VERSION };
}

/** #print の出力から構成子名と型を抜く。 */
function constructorsOf(fullName) {
  const r = leanEval(cfg, `import ${cfg.lean.root}\n#print ${fullName}\n`);
  const lines = joinWrapped(r.stdout.split("\n"));
  const i = lines.findIndex(l => l.startsWith("constructors:"));
  if (i < 0) return { error: (r.stderr || r.stdout).trim().slice(0, 500), constructors: [] };
  const ctors = [];
  for (const l of lines.slice(i + 1)) {
    const m = l.match(/^(\S+)\s*:\s*(.*)$/);
    if (m && m[1].startsWith(fullName + ".")) ctors.push({ name: m[1].slice(fullName.length + 1), type: m[2].trim() });
  }
  return { constructors: ctors };
}

// 同じ #print を繰り返さない（meta は commands / observations を何度も引く）
const printed = new Map();
function once(key, compute) { if (!printed.has(key)) printed.set(key, compute()); return printed.get(key); }
function commands() { return once("commands", () => constructorsOf(`${cfg.lean.root}.Runtime.Command`)); }
/** 内部入力（通知・worker からの観測）の合併型。持たないプロジェクトでは空。 */
function observations() { return once("observations", () => existsSync(join(cfg.lean.modelDir, "Runtime", "Observation.lean")) ? constructorsOf(`${cfg.lean.root}.Runtime.Observation`) : { constructors: [] }); }
function errors() { return constructorsOf(`${cfg.lean.root}.DomainError`); }

/** 複数の宣言を 1 回の `lake env lean` で #print し、宣言名ごとの行ブロックに切る。 */
function printMany(names) {
  if (!names.length) return {};
  const r = leanEval(cfg, `import ${cfg.lean.root}\n` + names.map(n => `#print ${n}`).join("\n") + "\n");
  const out = {};
  let cur = null;
  for (const raw of joinWrapped(r.stdout.split("\n"))) {
    const m = raw.match(/^(?:@\[[^\]]*\]\s*)?(?:structure|inductive|def|abbrev|theorem|opaque)\s+(\S+)/);
    if (m && names.includes(m[1])) { cur = m[1]; out[cur] = []; }
    if (cur) out[cur].push(raw);
  }
  return out;
}

/** Runtime/Json.lean の手書き `instance : FromJson <T>` と直前の docstring（人が打つ表記の注記）。`deriving instance` は手書きではない。
    docstring の無い手書き instance（Snapshot / Actor / Command など、object を受けるもの）は注記の対象外。 */
function wireHints() {
  const hints = {};
  const src = readFileSync(join(cfg.lean.modelDir, "Runtime", "Json.lean"), "utf8");
  for (const m of src.matchAll(/(?:\/--\s*((?:(?!-\/)[\s\S])*?)\s*-\/\s*)?^instance\s*:\s*FromJson\s+\(?([^\s()]+)/gm)) if (m[1]) hints[m[2]] = m[1];
  return hints;
}

/** コマンドごとの入力の形: 構成子 → ペイロード構造体のフィールド（組み立ては schema.mjs。Lean を呼ぶのはここ）。 */
function commandSchemas() {
  const ctors = commands().constructors;
  return schemasFrom(ctors, printMany(payloadHeads(ctors)), wireHints(), cfg.lean.root, printMany);
}

/** 内部入力ごとの形（コマンドの入力欄とは別に出す — 利用者のフォームに観測を混ぜない）。 */
function observationSchemas() {
  const ctors = observations().constructors;
  if (!ctors.length) return {};
  return schemasFrom(ctors, printMany(payloadHeads(ctors)), wireHints(), cfg.lean.root, printMany);
}

async function outlets() {
  const s = scenarios();
  if (!s.length) return { error: "シナリオが見つかりません（scenarioByName）", outlets: [] };
  const res = await callLean(cfg, { cmd: "init", scenario: s[0] }, { build });
  if (!res.ok) return { error: res, outlets: [] };
  return { scenario: s[0], outlets: Object.keys(res.ok.views ?? {}), stateKeys: Object.keys(res.ok.state ?? {}) };
}

function commonFields() {
  const out = {};
  if (opts.viewer !== undefined) out.viewer = jsonArg(opts.viewer);
  if (opts.actor !== undefined) out.actor = jsonArg(opts.actor);
  if (opts.today !== undefined) out.today = opts.today;
  return out;
}

function summarizeTrace(trace) {
  return trace.map((t, i) => {
    const cmdName = t.command && typeof t.command === "object" ? Object.keys(t.command)[0] : JSON.stringify(t.command);
    const who = t.actor ? JSON.stringify(t.actor) : "-";
    if (t.domainError !== undefined) return `#${i + 1} ${cmdName} by ${who} → domainError: ${JSON.stringify(t.domainError)}`;
    if (t.error !== undefined) return `#${i + 1} ${cmdName} by ${who} → protocol error: ${t.error}`;
    return `#${i + 1} ${cmdName} by ${who} → ok`;
  });
}

/** external の 1 手の要約: 入力の名前（command は当事者も）と result、refused なら domainError、fault なら契約、環境の cursor。 */
function summarizeExternalResult(t, i) {
  const { kind, name } = traceInputOf(t);
  const who = kind === "command" ? ` by ${t.actor ? JSON.stringify(t.actor) : "-"}` : "";
  const head = `#${i} ${kind === "observation" ? "observation " : ""}${name ?? "?"}${who}${typeof t.fault === "string" ? ` (fault ${t.fault})` : ""}`;
  const env = t.env ? `  [env cursor ${t.env.cursor}/${(t.env.script ?? []).length}]` : "";
  if (t.result === "refused") return `${head} → refused: ${JSON.stringify(t.domainError)}${env}`;
  if (t.result === "fault") return `${head} → fault: ${t.faultContract?.name} (portCalls ${t.faultContract?.portCalls})${env}`;
  return `${head} → ${t.result ?? "?"}${env}`;
}

/** external のリクエストを選択肢から組む。環境は名前（--environment）か script そのもの（--env）のどちらか一方。 */
function externalRequest(action) {
  const req = { cmd: "external", version: EXTERNAL_VERSION, action, ...commonFields() };
  const scenario = () => { if (!opts.scenario) fail("--scenario が要ります"); req.scenario = opts.scenario; };
  const state = () => { req.state = jsonArg(opts.state); if (!req.state) fail("--state @file が要ります"); };
  const environment = () => {
    if (opts.environment !== undefined && opts.env !== undefined) fail("--environment（名前）と --env（script そのもの）はどちらか一方");
    if (opts.environment !== undefined) { if (typeof opts.environment !== "string") fail("--environment には名前が要ります"); req.environment = opts.environment; }
    if (opts.env !== undefined) req.env = jsonArg(opts.env);
  };
  switch (action) {
    case "init": scenario(); environment(); break;
    case "views": state(); break;
    case "step":
      state(); req.env = jsonArg(opts.env); req.input = jsonArg(opts.input);
      if (!req.env || !req.input) fail("--env J|@file（init の応答の env）と --input J|@file（{command,actor} か {observation}）が要ります");
      break;
    default: {
      scenario(); req.inputs = jsonArg(opts.inputs);
      if (!Array.isArray(req.inputs)) fail("--inputs は配列（JSON か @file）");
      environment();
      if (opts["stop-at"] !== undefined) {
        const n = Number(opts["stop-at"]);
        if (!Number.isInteger(n) || n < 0) fail("--stop-at は 0 以上の整数（流れを止めた時点の cursor）");
        req.stopAt = n;
      }
    }
  }
  return req;
}

try {
  switch (cmd) {
    case "scenarios": printJson(scenarios()); break;
    case "environments": printJson(environments()); break;
    case "commands": printJson(commands()); break;
    case "errors": printJson(errors()); break;
    case "outlets": printJson(await outlets()); break;
    case "schemas": printJson(commandSchemas()); break;
    case "meta": {
      const obs = observations().constructors;
      // observations は内部入力（通知・worker）: 構成子名とペイロード型の完全名。公開受信の有無は OpenAPI 側（contract-check）が決める
      printJson({ project: cfg.project, lean: { dir: cfg.lean.dir, root: cfg.lean.root, exe: cfg.lean.exe, bin: cfg.lean.bin },
        scenarios: scenarios(), environments: environments(), external: await externalProtocol(),
        commands: commands().constructors.map(c => c.name), commandTypes: Object.fromEntries(commands().constructors.map(c => [c.name, payloadTypeOf(c)])),
        observations: obs.map(c => c.name), observationTypes: Object.fromEntries(obs.map(c => [c.name, payloadTypeOf(c)])),
        ports: ports(cfg), errors: errors().constructors.map(c => c.name), views: await outlets(), schemas: commandSchemas(), observationSchemas: observationSchemas() });
      break;
    }
    case "external": {
      const action = rest[0];
      if (!EXTERNAL_ACTIONS.includes(action)) fail(`external には ${EXTERNAL_ACTIONS.join(" | ")} のどれかが要ります`);
      const req = externalRequest(action);
      const res = await callLean(cfg, req, { build });
      if (!res.ok) { printJson(res); process.exit(1); }
      if (opts.full || opts.json || action === "init" || action === "views") { printJson(res); break; }
      if (action === "step") {
        // step の応答は入力の写しを持たないので、名前と当事者はリクエスト（入力の actor が無ければ既定の actor）から補う
        console.log(summarizeExternalResult({ actor: req.actor, ...req.input, ...res.ok }, 1));
        if (res.ok.views) { console.log("--- views ---"); printJson(res.ok.views); }
        break;
      }
      const trace = res.ok.trace ?? [];
      trace.forEach((t, i) => console.log(summarizeExternalResult(t, i + 1)));
      const last = [...trace].reverse().find(t => t.views);
      if (last) { console.log("--- final views ---"); printJson(last.views); }
      if (res.ok.env) console.log(`--- env --- cursor ${res.ok.env.cursor}/${(res.ok.env.script ?? []).length}`);
      break;
    }
    case "print": {
      if (!rest.length) fail("print には名前が要ります（例: MonoWa.Runtime.Command）");
      const src = `import ${cfg.lean.root}\n` + rest.map(n => `#print ${n}`).join("\n") + "\n";
      const r = leanEval(cfg, src);
      process.stdout.write(r.stdout);
      if (r.stderr.trim()) process.stderr.write(r.stderr);
      process.exit(r.status ?? 0);
    }
    case "init": {
      if (!opts.scenario) fail("--scenario が要ります");
      printJson(await callLean(cfg, { cmd: "init", scenario: opts.scenario, ...commonFields() }, { build })); break;
    }
    case "run": {
      if (!opts.scenario) fail("--scenario が要ります");
      const commandsArg = jsonArg(opts.commands);
      if (!Array.isArray(commandsArg)) fail("--commands は配列（JSON か @file）");
      const res = await callLean(cfg, { cmd: "flow", scenario: opts.scenario, commands: commandsArg, ...commonFields() }, { build });
      if (!res.ok) { printJson(res); process.exit(1); }
      const trace = res.ok.trace;
      if (opts.full || opts.json) { printJson(res); break; }
      for (const line of summarizeTrace(trace)) console.log(line);
      const last = [...trace].reverse().find(t => t.views);
      if (last) { console.log("--- final views ---"); printJson(last.views); }
      break;
    }
    case "step": {
      const state = jsonArg(opts.state); const command = jsonArg(opts.command);
      if (!state || !command) fail("--state @file と --command が要ります");
      printJson(await callLean(cfg, { cmd: "step", state, command, ...commonFields() }, { build })); break;
    }
    case "views": {
      const state = jsonArg(opts.state);
      if (!state) fail("--state @file が要ります");
      printJson(await callLean(cfg, { cmd: "views", state, ...commonFields() }, { build })); break;
    }
    case "raw": {
      const req = jsonArg(rest[0] ?? "-");
      printJson(await callLean(cfg, req, { build })); break;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter(l => l.startsWith("//")).map(l => l.slice(3)).join("\n"));
      process.exit(cmd ? 1 : 0);
  }
} catch (e) { fail(e.message, e.exitCode ?? 1); }
