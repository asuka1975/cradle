#!/usr/bin/env node
// lean-check — Lean 仕様の層の壁と証明方針を機械検査する（lake build とは別の、grep で決まる規約）。
//
//   lean-check [--build] [--smoke] [--json]
//     --build は値を取らない（lake build も検査に入れる）。golden-check / spec-query の --build auto|always|never とは別の意味
// 規則は lean-rules.mjs の checkLean。ここは引数と設定を読み、lake build と --smoke を走らせ、数えて出すだけ。
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
//   wiring    : Runtime/Command.lean の構成子が Json.lean（ワイヤ）と Machine.lean（applyCommand の腕）の両方に現れる。
//               Runtime/Observation.lean（内部入力の合併型）も同じで、腕は applyObservation。Observation 形の UseCase があるのに無ければ error。
//               Runtime/Environment.lean を持つなら、Port の操作ごとに "<Port>" と "<操作>"（小文字始まり）の文字列（環境のワイヤ形式）も Json.lean に要る。
//               外部能力の配線は揃って要る: Port の置き場があるのに Runtime/Environment.lean が無い、Environment.lean と Main.lean の cmd external が片方だけ、は error
//   usecase   : Application/UseCase/<X>/ は Command+UseCase（更新系）・Observation+UseCase（内部入力）・ReadModel+QueryService+UseCase（参照系）の
//               どれか 1 つで、validate / execute / query の固定名を持つ（Port を使う更新系・内部入力は request を持ち、mkRequest / apply も固定名）。
//               内部入力の UseCase は名義（ActorContext）を受けない
//   port      : Application/Port/<Port>/<操作>.lean（Domain/Port も同じ）は固定名 Request / Outcome を持ち、関数フィールドを持たない。Port 名は Repository で終えない
//   --smoke   : CLI に init を流して ok が返ることを確かめる
//   orphan    : <Root>.lean から import で辿れないモジュール（lake build が検査しないファイル）
//   scaffold  : 骨格のサンプルドメイン（メモ）が残っているのに documents/ddd に探索の事実がある（実ドメインを形式化して置き換える）
import { existsSync } from "node:fs";
import { loadConfigOrFail, parseArgs, rel, lakeBuild, callLean, fail, scenarioNames } from "./lib.mjs";
import { checkLean } from "./lean-rules.mjs";

const opts = parseArgs(process.argv.slice(2), { build: "bool", smoke: "bool", json: "bool" });
const cfg = loadConfigOrFail();
const modelDir = cfg.lean.modelDir;
if (!existsSync(modelDir)) fail(`Lean モデルのディレクトリがありません: ${modelDir}`);

const { files, findings } = checkLean(cfg);

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
    // 流す出発点は spec-query scenarios の先頭（scenarioByName の腕）。ほかの def の文字列の腕（値オブジェクト・environmentByName）は出発点ではない
    const res = await callLean(cfg, { cmd: "init", scenario: scenarioNames(cfg)[0] ?? "basic" }, { build: "never" });
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
// process.exit はパイプにまだ書いていない stdout を捨てる（--json が 64KB 前後で切れる）。終了コードだけを置いて書き切らせる
process.exitCode = ok ? 0 : 1;
