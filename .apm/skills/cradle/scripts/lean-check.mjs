#!/usr/bin/env node
// lean-check — Lean 仕様の層の壁と証明方針を機械検査する（lake build とは別の、grep で決まる規約）。
//
//   lean-check [--build] [--json]
//
// 検査項目（cradle.json の lean.* で調整）:
//   sorry     : 未証明の残数 <= lean.sorryMax（既定 0）
//   axiom     : 禁止
//   partial   : 警告（停止性が示せない再帰）
//   walls     : Domain は Application/Runtime を import しない・Application は Runtime を import しない
//   cqrs      : 読み取り側（QueryService.lean を持つ UseCase ディレクトリ・ReadModel.lean・View.lean）は Domain.Entity を import しない
//               （例外は lean.entityImportAllow と、Command.lean を持つ更新系 UseCase ディレクトリ）
//   mentions  : モデルが生成器（lean.forbiddenMentions）に言及しない
//   actor     : @[actorContext] の structure はフィールドを 1 つ以上持つ（0 だと生成器が不正な Kotlin を出す）
//   annot     : @[aggregateRoot] は Domain/Entity/ だけ、@[repositoryState] の型名は *RepositoryState / *IdGeneratorState
//   json      : Domain / Application で ToJson / FromJson を deriving しない（境界の関心）
//   wiring    : Runtime/Command.lean の構成子が Json.lean（ワイヤ）と Machine.lean（apply の腕）の両方に現れる
//   usecase   : Application/UseCase/<X>/ は Command+UseCase（更新系）か ReadModel+QueryService+UseCase（参照系）で、validate / execute / query の固定名を持つ
//   --smoke   : CLI に init を流して ok が返ることを確かめる
//   orphan    : <Root>.lean から import で辿れないモジュール（lake build が検査しないファイル）
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { readdirSync, statSync } from "node:fs";
import { loadConfig, parseArgs, walk, rel, lakeBuild, callLean, fail } from "./lib.mjs";

const opts = parseArgs(process.argv.slice(2), { build: "bool", smoke: "bool", json: "bool" });
const cfg = loadConfig();
const root = cfg.lean.root;
const modelDir = cfg.lean.modelDir;
if (!existsSync(modelDir)) fail(`Lean モデルのディレクトリがありません: ${modelDir}`);

const files = walk(modelDir, { ext: [".lean"] });
const mainFile = join(cfg.lean.rootDir, "Main.lean");
const allFiles = existsSync(mainFile) ? [...files, mainFile] : files;
const findings = [];
const add = (rule, severity, file, line, message) => findings.push({ rule, severity, file: rel(cfg.root, file), line, message });

const stripComments = (text) => text.replace(/--.*$/gm, "").replace(/\/-[\s\S]*?-\//g, (m) => m.replace(/[^\n]/g, ""));

for (const f of allFiles) {
  const raw = readFileSync(f, "utf8");
  const code = stripComments(raw);
  const relPath = rel(modelDir, f);
  const layer = relPath.split("/")[0];
  const lines = raw.split("\n");

  const codeLines = code.split("\n");
  lines.forEach((l, i) => {
    const c = l.replace(/--.*$/, "");
    const cl = codeLines[i] ?? "";
    if (/\bsorry\b/.test(c)) add("sorry", "info", f, i + 1, "未証明（sorry）");
    if (/^\s*axiom\b/.test(c)) add("axiom", "error", f, i + 1, "axiom は禁止（矛盾の混入経路）");
    if (/^\s*(private\s+|protected\s+)?partial\s+def\b/.test(c)) add("partial", "warn", f, i + 1, "partial def（停止性が示せない再帰）");
    if (/^\s*unsafe\s+def\b/.test(c)) add("unsafe", "error", f, i + 1, "unsafe は禁止");
    for (const m of cfg.lean.forbiddenMentions) if (cl.toLowerCase().includes(m.toLowerCase())) add("mentions", "error", f, i + 1, `生成器への依存 (${m}) — モデルは生成器を知らない`);
  });

  const imports = [...code.matchAll(/^import\s+(\S+)/gm)].map(m => m[1]);
  const importsAny = (prefix) => imports.filter(i => i.startsWith(`${root}.${prefix}`));
  if (layer === "Domain") {
    for (const i of importsAny("Application")) add("walls", "error", f, 1, `Domain が Application を import (${i}) — 層の壁`);
    for (const i of importsAny("Runtime")) add("walls", "error", f, 1, `Domain が Runtime を import (${i}) — 表現の仮置きに依存`);
    for (const i of importsAny("Laws")) add("walls", "error", f, 1, `Domain が Laws を import (${i})`);
  }
  if (layer === "Application") {
    for (const i of importsAny("Runtime")) add("walls", "error", f, 1, `Application が Runtime を import (${i}) — 表現の仮置きに依存`);
    for (const i of importsAny("Laws")) add("walls", "error", f, 1, `Application が Laws を import (${i})`);
    // CQRS: 読み取り側は Entity を見ない
    const dir = dirname(f);
    const isUseCaseDir = relPath.split("/")[1] === "UseCase" && relPath.split("/").length >= 4;
    const writeSide = isUseCaseDir && existsSync(join(dir, "Command.lean"));
    const readSide = isUseCaseDir ? existsSync(join(dir, "QueryService.lean")) && !writeSide
      : ["ReadModel.lean", "View.lean", "Ordering.lean"].includes(basename(f));
    const allowed = cfg.lean.entityImportAllow.some(a => relPath === a || relPath.startsWith(a.replace(/\/$/, "") + "/"));
    if (readSide && !allowed) {
      for (const i of importsAny("Domain.Entity")) add("cqrs", "error", f, 1, `読み取り側が Domain.Entity を import (${i}) — 読むのは Row だけ`);
    }
  }
}

// actorContext: フィールド 0 の印
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  const re = /@\[actorContext\]\s*\n\s*structure\s+(\w+)[^\n]*\n([\s\S]*?)(?=\n\S|$)/g;
  let m;
  while ((m = re.exec(raw))) {
    const body = m[2].replace(/--.*$/gm, "").replace(/\/-[\s\S]*?-\//g, "");
    const fields = (body.match(/^\s+\w+\s*:/gm) ?? []).length;
    if (fields === 0) add("actor", "error", f, raw.slice(0, m.index).split("\n").length, `@[actorContext] の ${m[1]} にフィールドが無い — 印だけの型は名義にしない`);
  }
}

// annot / json: 印の置き場と deriving
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  const relPath = rel(modelDir, f);
  const layer = relPath.split("/")[0];
  for (const m of raw.matchAll(/@\[aggregateRoot\]/g)) if (!relPath.startsWith("Domain/Entity/")) add("annot", "error", f, raw.slice(0, m.index).split("\n").length, "@[aggregateRoot] は Domain/Entity/ の具体構造体にだけ付ける");
  for (const m of raw.matchAll(/@\[repositoryState\]\s*\n\s*structure\s+(\w+)/g)) if (!/(RepositoryState|IdGeneratorState)$/.test(m[1])) add("annot", "error", f, raw.slice(0, m.index).split("\n").length, `@[repositoryState] の ${m[1]} は <Root>RepositoryState か <X>IdGeneratorState の名前にする（生成器の命名規約）`);
  if (layer === "Domain" || layer === "Application") {
    for (const m of raw.matchAll(/deriving[^\n]*\b(ToJson|FromJson)\b/g)) add("json", "error", f, raw.slice(0, m.index).split("\n").length, "仕様層で ToJson / FromJson を deriving しない — Runtime/Json.lean が後付けする");
  }
}

// wiring: Command の構成子 ↔ Json.lean ↔ Machine.lean
{
  const cmdFile = join(modelDir, "Runtime", "Command.lean");
  const jsonFile = join(modelDir, "Runtime", "Json.lean");
  const machFile = join(modelDir, "Runtime", "Machine.lean");
  if (existsSync(cmdFile)) {
    const code = stripComments(readFileSync(cmdFile, "utf8"));
    const block = code.match(/inductive\s+Command\b[\s\S]*?(?=\n(?:deriving|end|def|structure|inductive|theorem)\b|$)/);
    const ctors = block ? [...block[0].matchAll(/^\s*\|\s*(\w+)/gm)].map(m => m[1]) : [];
    const jsonText = existsSync(jsonFile) ? readFileSync(jsonFile, "utf8") : "";
    const machText = existsSync(machFile) ? stripComments(readFileSync(machFile, "utf8")) : "";
    for (const c of ctors) {
      if (jsonText && !jsonText.includes(`"${c}"`)) add("wiring", "error", jsonFile, 1, `構成子 ${c} のワイヤ形式（"${c}"）が Json.lean に無い`);
      if (machText && !new RegExp(`\\.${c}\\b`).test(machText)) add("wiring", "error", machFile, 1, `構成子 ${c} の腕が Machine.lean の apply に無い`);
    }
  }
}

// usecase: ディレクトリの形と固定名
{
  const ucDir = join(modelDir, "Application", "UseCase");
  if (existsSync(ucDir)) {
    for (const name of readdirSync(ucDir)) {
      const d = join(ucDir, name);
      if (!statSync(d).isDirectory()) continue;
      const has = (f) => existsSync(join(d, f));
      const read = (f) => stripComments(readFileSync(join(d, f), "utf8"));
      const write = has("Command.lean"), readSide = has("QueryService.lean");
      if (!has("UseCase.lean")) { add("usecase", "error", d, 1, `${name}/ に UseCase.lean が無い`); continue; }
      if (!write && !readSide) add("usecase", "error", d, 1, `${name}/ は Command.lean（更新系）か QueryService.lean（参照系）を持つ`);
      if (readSide && !has("ReadModel.lean")) add("usecase", "error", d, 1, `${name}/ は参照系なのに ReadModel.lean が無い`);
      const uc = read("UseCase.lean");
      if (!/\bdef\s+validate\b/.test(uc)) add("usecase", "error", join(d, "UseCase.lean"), 1, "固定名 validate が無い");
      if (!/\bdef\s+execute\b/.test(uc)) add("usecase", "error", join(d, "UseCase.lean"), 1, "固定名 execute が無い");
      if (readSide && !/\bdef\s+query\b/.test(read("QueryService.lean"))) add("usecase", "error", join(d, "QueryService.lean"), 1, "固定名 query が無い");
    }
  }
}

// orphan: ルートから import で辿れないモジュール
{
  const rootFile = join(cfg.lean.rootDir, `${root}.lean`);
  if (existsSync(rootFile)) {
    const seen = new Set();
    const modOf = (f) => `${root}.${rel(modelDir, f).replace(/\.lean$/, "").split("/").join(".")}`;
    const fileOf = (mod) => join(cfg.lean.rootDir, ...mod.split(".")) + ".lean";
    const stack = [rootFile];
    while (stack.length) {
      const f = stack.pop();
      if (!existsSync(f) || seen.has(f)) continue;
      seen.add(f);
      const code = stripComments(readFileSync(f, "utf8"));
      for (const m of code.matchAll(/^import\s+(\S+)/gm)) if (m[1].startsWith(root + ".")) stack.push(fileOf(m[1]));
    }
    for (const f of files) if (!seen.has(f)) add("orphan", "warn", f, 1, `${modOf(f)} は ${root}.lean から辿れない（lake build が検査しない）`);
  }
}

const counts = {};
for (const x of findings) counts[x.rule] = (counts[x.rule] ?? 0) + 1;
const sorryCount = counts.sorry ?? 0;
const errors = findings.filter(x => x.severity === "error");
const sorryOver = sorryCount > cfg.lean.sorryMax;

let buildResult = null;
if (opts.build) {
  try { lakeBuild(cfg); buildResult = "ok"; } catch (e) { buildResult = e.message; }
}
let smokeResult = null;
if (opts.smoke) {
  try {
    const scen = [...walk(cfg.lean.rootDir, { ext: [".lean"] })].flatMap(f => [...readFileSync(f, "utf8").matchAll(/\|\s*"([^"]+)"\s*=>\s*some/g)].map(m => m[1]))[0];
    const res = await callLean(cfg, { cmd: "init", scenario: scen ?? "basic" }, { build: "never" });
    smokeResult = res.ok ? "ok" : `init が ok を返さない: ${JSON.stringify(res).slice(0, 300)}`;
  } catch (e) { smokeResult = e.message; }
}

const ok = errors.length === 0 && !sorryOver && (buildResult === null || buildResult === "ok") && (smokeResult === null || smokeResult === "ok");
if (opts.json) console.log(JSON.stringify({ ok, sorry: sorryCount, sorryMax: cfg.lean.sorryMax, counts, build: buildResult, smoke: smokeResult, findings }, null, 2));
else {
  console.log(`lean-check: ${files.length} files under ${rel(cfg.root, modelDir)}`);
  for (const x of findings.filter(x => x.severity !== "info")) console.log(`${x.severity.padEnd(5)} ${x.rule.padEnd(8)} ${x.file}:${x.line}  ${x.message}`);
  console.log(`sorry: ${sorryCount} (max ${cfg.lean.sorryMax})${sorryOver ? "  <-- 超過" : ""}`);
  if (sorryCount) for (const x of findings.filter(x => x.rule === "sorry")) console.log(`      ${x.file}:${x.line}`);
  if (buildResult !== null) console.log(`lake build: ${buildResult === "ok" ? "ok" : "FAILED\n" + buildResult}`);
  if (smokeResult !== null) console.log(`CLI smoke: ${smokeResult}`);
  console.log(ok ? "OK" : "NG");
}
process.exit(ok ? 0 : 1);
