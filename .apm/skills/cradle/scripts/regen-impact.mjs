#!/usr/bin/env node
// regen-impact — Lean を変えたあと、生成物を作り直して「何が変わり、誰に効くか」を機械で出す。
//   regen-impact [--report] [--dry-run] [--no-regen] [--no-golden] [--manifest file] [--json]
//     --report   生成物の差分と参照元（手書き実装・契約テスト）の一覧を出す（既定）
//     --dry-run  再生成の結果を見たあと生成ディレクトリを git で元に戻す
//     --no-regen 再生成せず、作業ツリーにある生成物の差分だけを読む
//     --no-golden golden 回帰を省く
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, parseArgs, walk, rel, git, fail } from "./lib.mjs";

const opts = parseArgs(process.argv.slice(2), { report: "bool", "dry-run": "bool", "no-regen": "bool", "no-golden": "bool", json: "bool", force: "bool" });
const cfg = loadConfig();
const gens = cfg.backend.generated;

const dirty = git(cfg.root, ["status", "--porcelain", "--", ...gens]);
if (dirty && !opts["no-regen"] && !opts.force) fail(`生成ディレクトリに未コミットの差分があります。先にコミットするか、差分だけ読むなら --no-regen:\n${dirty}`);

let regenOut = null;
if (!opts["no-regen"]) {
  const r = spawnSync("sh", ["-c", cfg.backend.regenerate], { cwd: join(cfg.root, cfg.backend.dir), encoding: "utf8" });
  regenOut = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.status !== 0) fail(`再生成に失敗しました（${cfg.backend.regenerate}）:\n${regenOut.slice(-3000)}`, 2);
}

const nameStatus = git(cfg.root, ["diff", "--name-status", "HEAD", "--", ...gens]).split("\n").filter(Boolean).map(l => { const [st, ...p] = l.split("\t"); return { status: st[0], path: p[p.length - 1] }; });
const untracked = git(cfg.root, ["ls-files", "--others", "--exclude-standard", "--", ...gens]).split("\n").filter(Boolean).map(path => ({ status: "A", path }));
const changed = [...nameStatus, ...untracked];

const TYPE_DECL = /^(?:public\s+|internal\s+|private\s+)?(?:abstract\s+|open\s+|sealed\s+|data\s+|value\s+|enum\s+|annotation\s+)*(interface|class|object|typealias)\s+`?([A-Za-z_][\w]*)`?/;
const MEMBER_DECL = /^\s+(?:override\s+|abstract\s+|open\s+|suspend\s+|operator\s+|infix\s+|inline\s+|public\s+|internal\s+|protected\s+)*(fun|val|var)\s+(?:<[^>]*>\s*)?(?:[A-Za-z_][\w.]*\.)?`?([A-Za-z_][\w]*)`?/;
const TOP_FUN = /^(?:public\s+|internal\s+|private\s+)?(?:inline\s+|suspend\s+)*(fun|val|var)\s+(?:<[^>]*>\s*)?(?:[A-Za-z_][\w.]*\.)?`?([A-Za-z_][\w]*)`?/;
/** 宣言の一覧: {key, name, owner, kind, sig}。sig（署名行）が一致すれば同じ宣言とみなす。 */
function declsOf(text) {
  const out = new Map();
  let owner = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || /^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    let m = line.match(TYPE_DECL);
    if (m) { owner = m[2]; out.set(`type:${m[2]}`, { name: m[2], owner: null, kind: m[1], sig: line.trim() }); continue; }
    m = line.match(TOP_FUN);
    if (m) { out.set(`top:${m[2]}`, { name: m[2], owner: null, kind: m[1], sig: line.trim() }); continue; }
    m = line.match(MEMBER_DECL);
    if (m && owner) out.set(`member:${owner}.${m[2]}:${line.trim()}`, { name: m[2], owner, kind: m[1], sig: line.trim() });
  }
  return out;
}
function textAt(path, which) {
  if (which === "HEAD") { try { return git(cfg.root, ["show", `HEAD:${path}`]); } catch { return ""; } }
  const p = join(cfg.root, path); return existsSync(p) ? readFileSync(p, "utf8") : "";
}
/** 変わった宣言 = 署名行が片方にしか無いもの（名前が同じでも署名が変われば「変更」）。 */
const symbols = new Map(); // key -> { name, owner, kind, files:Set, change }
for (const c of changed) {
  const before = declsOf(textAt(c.path, "HEAD"));
  const after = declsOf(textAt(c.path, "WT"));
  const sigOf = (m) => new Set([...m.values()].map(d => `${d.owner ?? ""}|${d.name}|${d.sig}`));
  const sb = sigOf(before), sa = sigOf(after);
  const touched = [];
  for (const d of before.values()) if (!sa.has(`${d.owner ?? ""}|${d.name}|${d.sig}`)) touched.push({ ...d, change: [...after.values()].some(x => x.name === d.name && x.owner === d.owner) ? "changed" : "removed" });
  for (const d of after.values()) if (!sb.has(`${d.owner ?? ""}|${d.name}|${d.sig}`) && ![...before.values()].some(x => x.name === d.name && x.owner === d.owner)) touched.push({ ...d, change: "added" });
  for (const d of touched) {
    const key = `${d.owner ?? ""}.${d.name}`;
    const e = symbols.get(key) ?? { name: d.name, owner: d.owner, kind: d.kind, files: new Set(), change: d.change };
    e.files.add(c.path); if (e.change !== d.change) e.change = "changed";
    symbols.set(key, e);
  }
}

// 参照元: 型はその名前で、メンバーは「所有する型を参照し、かつその名前を呼ぶ／実装する」ファイルで探す
const handFiles = [...walk(join(cfg.root, cfg.backend.dir, "src", "main"), { ext: [".kt"] }), ...walk(join(cfg.root, cfg.backend.dir, "src", "test"), { ext: [".kt"] })]
  .filter(f => !gens.some(g => rel(cfg.root, f).startsWith(g.replace(/\/$/, "") + "/")));
const handTexts = handFiles.map(f => ({ file: rel(cfg.root, f), text: readFileSync(f, "utf8") }));
const impact = [];
for (const e of symbols.values()) {
  const nameRe = new RegExp(`\\b${e.name}\\b`);
  const refs = e.owner
    ? handTexts.filter(h => new RegExp(`\\b${e.owner}\\b`).test(h.text) && new RegExp(`(\\.|\\bfun\\s+|\\bval\\s+|\\bvar\\s+)${e.name}\\b`).test(h.text)).map(h => h.file)
    : handTexts.filter(h => nameRe.test(h.text)).map(h => h.file);
  impact.push({ symbol: e.owner ? `${e.owner}.${e.name}` : e.name, kinds: [e.change], generatedFiles: [...e.files], referencedBy: refs });
}
impact.sort((a, b) => b.referencedBy.length - a.referencedBy.length || a.symbol.localeCompare(b.symbol));

// 契約テスト: 生成された抽象テストと具象の配線
const abstractTests = changed.filter(c => /ContractTest\.kt$/.test(c.path)).map(c => c.path.replace(/.*\//, "").replace(/\.kt$/, ""));
const unwired = abstractTests.filter(n => !handTexts.some(h => new RegExp(`:\\s*${n}\\s*\\(`).test(h.text)));

let golden = null;
if (!opts["no-golden"]) {
  const args = [join(import.meta.dirname, "golden-check.mjs"), "--json"];
  if (opts.manifest) args.push("--manifest", opts.manifest);
  const r = spawnSync(process.execPath, args, { cwd: cfg.root, encoding: "utf8" });
  try { golden = JSON.parse(r.stdout); } catch { golden = { error: (r.stderr || r.stdout).slice(-2000) }; }
}

if (opts["dry-run"]) { git(cfg.root, ["checkout", "--", ...gens.filter(g => existsSync(join(cfg.root, g)))]); git(cfg.root, ["clean", "-fdq", "--", ...gens.filter(g => existsSync(join(cfg.root, g)))]); }

const result = { changedGeneratedFiles: changed, symbols: impact, unwiredContractTests: unwired, golden, restored: !!opts["dry-run"] };
if (opts.json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`# regen-impact — ${cfg.project}\n`);
  console.log(`生成物の差分: ${changed.length} ファイル` + (changed.length ? "\n" + changed.map(c => `  ${c.status} ${c.path}`).join("\n") : "（なし — モデルの変更は生成物に現れていない）"));
  const hit = impact.filter(i => i.referencedBy.length);
  console.log(`\n影響を受ける手書きコード（変わった生成シンボルを参照している）: ${hit.length} シンボル`);
  for (const i of hit) console.log(`  ${i.symbol} [${i.kinds.join(",")}]\n` + i.referencedBy.map(f => `      ${f}`).join("\n"));
  const orphan = impact.filter(i => !i.referencedBy.length);
  if (orphan.length) console.log(`\n参照元の無い生成シンボル（新規 interface など — これから実装するもの）: ${orphan.map(i => i.symbol).join(", ")}`);
  if (unwired.length) console.log(`\n未配線の契約テスト: ${unwired.join(", ")}`);
  if (golden) {
    if (golden.error) console.log(`\ngolden 回帰: 実行できず — ${golden.error}`);
    else console.log(`\ngolden 回帰: ${golden.failed ? `${golden.failed} 件が変わった（意図した変更か確かめる）` : "全一致"}`);
    for (const r of (golden.report ?? []).filter(r => r.status === "changed")) console.log(`  CHANGED ${r.name}-${r.kind} at ${r.firstDivergence}${r.step ? ` (step #${r.step} ${r.command})` : ""}`);
  }
  if (opts["dry-run"]) console.log("\n（--dry-run: 生成ディレクトリは元に戻した）");
}
process.exit(0);
