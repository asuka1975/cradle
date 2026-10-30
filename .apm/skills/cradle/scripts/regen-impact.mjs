#!/usr/bin/env node
// regen-impact — Lean を変えたあと、生成物を作り直して「何が変わり、誰に効くか」を機械で出す。
//   regen-impact [--report] [--dry-run] [--no-regen] [--force] [--no-golden] [--manifest file] [--json]
//     --report   生成物の差分と参照元（手書き実装・契約テスト）の一覧を出す（既定）
//     --dry-run  再生成の結果を見たあと生成ディレクトリを git で元に戻す（生成ディレクトリがクリーンなときだけ）
//     --no-regen 再生成せず、作業ツリーにある生成物の差分だけを読む
//     --force    生成ディレクトリに未コミットの差分があっても再生成して重ねる
//     --no-golden golden 回帰を省く
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfigOrFail, parseArgs, blankArg, walk, rel, git, fail, readText, cradleScript, contractTestWiring, goldenRowLines } from "./lib.mjs";
import { diffDecls, impactOf } from "./regen-core.mjs";

const opts = parseArgs(process.argv.slice(2), { report: "bool", "dry-run": "bool", "no-regen": "bool", "no-golden": "bool", json: "bool", force: "bool" });
// 値の無い --manifest は再生成する前に止める（golden-check に `--manifest true` を渡して、再生成の後に golden 回帰だけを落とさない）
if (blankArg(opts.manifest)) fail("--manifest には manifest のファイル（JSON）のパスが要ります");
const cfg = loadConfigOrFail();
const gens = cfg.backend.generated;

// git の外（リポジトリでない置き場）ではここで止まる。スタックトレースにしない
let dirty; try { dirty = git(cfg.root, ["status", "--porcelain", "--", ...gens]); } catch (e) { fail(e.message); }
// コミットが 1 つも無いリポジトリでは git status は通るが HEAD と比べられない。再生成する前に止める
try { git(cfg.root, ["rev-parse", "--verify", "-q", "HEAD"]); } catch { fail("まだコミットがありません。regen-impact は生成物を HEAD と比べるので、先にコミットしてから回す"); }
if (dirty && !opts["no-regen"] && !opts.force) fail(`生成ディレクトリに未コミットの差分があります。先にコミットするか、差分だけ読むなら --no-regen:\n${dirty}`);
// 元に戻す（checkout と clean）は始める前の差分とこの実行の出力を見分けないので、--no-regen・--force でも差分があれば --dry-run を断る
if (opts["dry-run"] && dirty) fail(`--dry-run は生成ディレクトリがクリーンなときだけ（元に戻すと未コミットの差分も消える）:\n${dirty}`);
/** --dry-run の後始末: 生成ディレクトリを HEAD に戻す。checkout は追跡しているファイルのあるものだけ（無いパスは git が断る）、
    clean は在るものだけに渡す（パスの無い git clean はリポジトリ全体の未追跡を消す）。 */
function restoreGenerated() {
  const tracked = gens.filter(g => git(cfg.root, ["ls-files", "--", g]));
  if (tracked.length) git(cfg.root, ["checkout", "--", ...tracked]);
  const present = gens.filter(g => existsSync(join(cfg.root, g)));
  if (present.length) git(cfg.root, ["clean", "-fdq", "--", ...present]);
}

let regenOut = null;
if (!opts["no-regen"]) {
  const r = spawnSync("sh", ["-c", cfg.backend.regenerate], { stdio: ["ignore", "pipe", "pipe"], cwd: join(cfg.root, cfg.backend.dir), encoding: "utf8" });
  regenOut = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.status !== 0) {
    // 作りかけの出力を残さない
    if (opts["dry-run"]) restoreGenerated();
    fail(`再生成に失敗しました（${cfg.backend.regenerate}）:\n${regenOut.slice(-3000)}`, 2);
  }
}

const nameStatus = git(cfg.root, ["diff", "--name-status", "HEAD", "--", ...gens]).split("\n").filter(Boolean).map(l => { const [st, ...p] = l.split("\t"); return { status: st[0], path: p[p.length - 1] }; });
const untracked = git(cfg.root, ["ls-files", "--others", "--exclude-standard", "--", ...gens]).split("\n").filter(Boolean).map(path => ({ status: "A", path }));
const changed = [...nameStatus, ...untracked];

function textAt(path, which) {
  if (which === "HEAD") { try { return git(cfg.root, ["show", `HEAD:${path}`]); } catch { return ""; } }
  return readText(join(cfg.root, path));
}
// 同じシンボルが複数のファイルで変わり、その変わり方がファイルごとに違えば「変更」
const symbols = new Map(); // key -> { name, owner, kind, files:Set, change }
for (const c of changed) {
  for (const d of diffDecls(textAt(c.path, "HEAD"), textAt(c.path, "WT"))) {
    const key = `${d.owner ?? ""}.${d.name}`;
    const e = symbols.get(key) ?? { name: d.name, owner: d.owner, kind: d.kind, files: new Set(), change: d.change };
    e.files.add(c.path); if (e.change !== d.change) e.change = "changed";
    symbols.set(key, e);
  }
}

// 参照元を探す手書き: src/main と src/test のうち生成ディレクトリの外
const handFiles = [...walk(join(cfg.root, cfg.backend.dir, "src", "main"), { ext: [".kt"] }), ...walk(join(cfg.root, cfg.backend.dir, "src", "test"), { ext: [".kt"] })]
  .filter(f => !gens.some(g => rel(cfg.root, f).startsWith(g.replace(/\/$/, "") + "/")));
const handTexts = handFiles.map(f => ({ file: rel(cfg.root, f), text: readFileSync(f, "utf8") }));
const impact = impactOf(symbols.values(), handTexts);

// 契約テスト: 変わった生成物のうちの抽象テストと具象の配線（Adapter の適合テストは src/adapterTest、ほかは src/test — status と同じ数え方）。
// 再生成で消えた（D）抽象テストは配線するものが無い。残った具象クラスは消えたシンボルの参照元に出る
const abstractTests = changed.filter(c => c.status !== "D" && /ContractTest\.kt$/.test(c.path)).map(c => c.path.replace(/.*\//, "").replace(/\.kt$/, ""));
const unwired = contractTestWiring(cfg, abstractTests).filter(w => !w.wired).map(w => w.name);

let golden = null;
if (!opts["no-golden"]) {
  const args = [cradleScript("golden-check.mjs"), "--json"];
  if (opts.manifest) args.push("--manifest", opts.manifest);
  const r = spawnSync(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], cwd: cfg.root, encoding: "utf8" });
  try { golden = JSON.parse(r.stdout); } catch { golden = { error: (r.stderr || r.stdout).slice(-2000) }; }
}

if (opts["dry-run"]) restoreGenerated();

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
    else console.log(`\ngolden 回帰: ${golden.failed ? `${golden.failed} 件が changed/error（意図した変更か確かめる）` : "全一致"}`);
    // ok 以外の行を golden-check と同じ言い方で（食い違いの詳しい行は golden-check に任せ、先頭の行だけ）
    for (const r of (golden.report ?? []).filter(r => r.status !== "ok")) console.log(`  ${goldenRowLines(r)[0]}`);
  }
  if (opts["dry-run"]) console.log("\n（--dry-run: 生成ディレクトリは元に戻した）");
}
process.exit(0);
