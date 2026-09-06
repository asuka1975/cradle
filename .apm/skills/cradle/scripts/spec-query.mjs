#!/usr/bin/env node
// spec-query — Lean 実行可能仕様への決定論的な問い合わせ。
// 仕様に関する問いは推測で答えず、この道具で Lean を動かした結果を引用する。
//
//   spec-query meta                               シナリオ・コマンド・失敗語彙・画面の口を JSON で
//   spec-query scenarios | commands | errors | outlets（画面の口） | schemas（コマンドごとの入力の形）
//   spec-query print <Name>...                    `lake env lean` の #print（型・構成子・フィールド）
//   spec-query init  --scenario S [--viewer J] [--actor J] [--today D]
//   spec-query run   --scenario S --commands J|@file [--actor J] [--viewer J] [--today D] [--full]
//   spec-query step  --state @file --command J --actor J [--viewer J] [--today D]
//   spec-query views --state @file --viewer J [--today D]
//   spec-query raw   @request.json | -            プロトコルそのままの素通し
//   共通: --build always|auto|never（既定 auto = バイナリが無ければ lake build）
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, callLean, leanEval, parseArgs, jsonArg, fail, walk } from "./lib.mjs";

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

/** `#print` の出力で、折り返された行（先頭が空白）を前の行につなぐ。 */
function joinWrapped(lines) {
  const out = [];
  for (const l of lines) {
    if (/^\s{4,}\S/.test(l) && out.length) out[out.length - 1] += " " + l.trim();
    else out.push(l);
  }
  return out;
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

function commands() { return constructorsOf(`${cfg.lean.root}.Runtime.Command`); }
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

/** structure / inductive の #print ブロックを {kind, params, fields | options} にする。 */
function parseDecl(lines) {
  if (!lines.length) return null;
  const head = lines[0];
  const params = [...head.matchAll(/\(([^()]*?)\s*:\s*Type[^)]*\)/g)].flatMap(m => m[1].trim().split(/\s+/));
  if (/^(?:@\[[^\]]*\]\s*)?structure\s/.test(head)) {
    const i = lines.findIndex(l => l.startsWith("fields:"));
    const fields = [];
    for (const l of lines.slice(i + 1)) {
      if (!l.startsWith("  ")) break;
      const m = l.match(/^\s+(\S+)\s*:\s*(.*)$/);
      if (m) fields.push({ name: m[1].split(".").pop(), type: m[2].trim() });
    }
    return { kind: "structure", params, fields };
  }
  if (/^(?:@\[[^\]]*\]\s*)?inductive\s/.test(head)) {
    const name = head.match(/inductive\s+(\S+)/)[1];
    const i = lines.findIndex(l => l.startsWith("constructors:"));
    const ctors = lines.slice(i + 1).map(l => l.match(/^(\S+)\s*:\s*(.*)$/)).filter(m => m && m[1].startsWith(name + ".")).map(m => ({ name: m[1].slice(name.length + 1), type: m[2].trim() }));
    // 引数の無い構成子だけの inductive は列挙（deriving ToJson は構成子名の文字列になる）
    if (ctors.length && ctors.every(c => c.type === name)) return { kind: "enum", params, options: ctors.map(c => c.name) };
    return { kind: "inductive", params, constructors: ctors };
  }
  return { kind: "other" };
}

/** 入力欄の種類を型名から決める（表示の都合。可否はモデルが決める）。id は {"id": n}、列挙は構成子名、値オブジェクトはフィールド名のオブジェクトで wire に乗る。 */
function kindOf(type, params) {
  let s = type.trim(), optional = false;
  if (/^Option\s+/.test(s)) { optional = true; s = s.replace(/^Option\s+/, "").replace(/^\((.*)\)$/, "$1").trim(); }
  const base = { type: s, optional };
  if (/^(List|Array)\b/.test(s)) return { ...base, kind: "json" };
  if (s === "Bool") return { ...base, kind: "bool" };
  if (/^(Nat|Int|Float|UInt\d+|USize)$/.test(s)) return { ...base, kind: "number" };
  if (s === "String") return { ...base, kind: "text" };
  if (/(^|\.)(Date|PlainDate)$/.test(s)) return { ...base, kind: "date" };
  const head = s.split(/\s+/)[0];
  if (params.includes(head) || /Id$/.test(head.split(".").pop())) return { ...base, kind: "id" };
  if (head.startsWith(cfg.lean.root + ".")) return { ...base, kind: "object", ref: head };
  return { ...base, kind: "json" };
}

/** コマンドごとの入力の形: 構成子 → ペイロード構造体のフィールド（値オブジェクトは 1 段だけ展開、列挙は選択肢）。 */
function commandSchemas() {
  const ctors = commands().constructors;
  const specs = {};
  for (const c of ctors) {
    const parts = c.type.split("→").map(x => x.trim());
    specs[c.name] = { arg: parts.length > 1 ? parts[0] : null };
  }
  const structNames = [...new Set(Object.values(specs).map(s => s.arg && s.arg.split(/\s+/)[0]).filter(Boolean))];
  const printed = printMany(structNames);
  const refs = new Set();
  for (const s of Object.values(specs)) {
    if (!s.arg) { s.fields = []; continue; }
    const head = s.arg.split(/\s+/)[0];
    const d = parseDecl(printed[head] ?? []);
    s.type = head;
    if (!d || d.kind !== "structure") { s.fields = null; continue; }
    s.fields = d.fields.map(f => ({ name: f.name, ...kindOf(f.type, d.params) }));
    for (const f of s.fields) if (f.kind === "object") refs.add(f.ref);
    delete s.arg;
  }
  const printed2 = printMany([...refs]);
  for (const s of Object.values(specs)) for (const f of s.fields ?? []) {
    if (f.kind !== "object") continue;
    const d = parseDecl(printed2[f.ref] ?? []);
    if (d?.kind === "enum") { f.kind = "enum"; f.options = d.options; }
    else if (d?.kind === "structure") f.fields = d.fields.map(g => ({ name: g.name, ...kindOf(g.type, d.params) })).map(g => g.kind === "object" ? { ...g, kind: "json" } : g);
    else f.kind = "json";
    delete f.ref;
  }
  return specs;
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

try {
  switch (cmd) {
    case "scenarios": printJson(scenarios()); break;
    case "commands": printJson(commands()); break;
    case "errors": printJson(errors()); break;
    case "outlets": printJson(await outlets()); break;
    case "schemas": printJson(commandSchemas()); break;
    case "meta": printJson({ project: cfg.project, lean: { dir: cfg.lean.dir, exe: cfg.lean.exe, bin: cfg.lean.bin },
      scenarios: scenarios(), commands: commands().constructors.map(c => c.name), errors: errors().constructors.map(c => c.name), views: await outlets(), schemas: commandSchemas() }); break;
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
