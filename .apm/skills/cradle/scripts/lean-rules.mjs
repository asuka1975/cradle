// lean-rules — lean-check の規則（検査項目の説明は lean-check.mjs の冒頭）。checkLean が規則を RULES の順に走らせ、指摘を集めて返す（引数・lake build・--smoke・数と出力は lean-check.mjs）。
// 規則は ctx（設定・ファイルの一覧・読み方・add）を受けて指摘を足す。指摘の順は RULES の順と各規則の中の順で決まり、--json の findings と文章の行はその順のまま出る
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { walk, rel, scaffoldSampleFiles, ports, readText, readableEntries, countEvents, stripLeanComments } from "./lib.mjs";

/** 規則の並び。行の規則・層の壁・CQRS は perFile がファイルごとに続けて見るので、ファイルをまたいで並べ替えない。 */
const RULES = [perFile, actorContext, annotJson, wiring, usecase, port, scaffold, orphan];

/** lean.modelDir（在ること）の下と lean/Main.lean の検査: { files（modelDir の下の .lean）, findings（{ rule, severity, file（cfg.root からの相対）, line, message }）}。 */
export function checkLean(cfg) {
  const modelDir = cfg.lean.modelDir;
  const files = walk(modelDir, { ext: [".lean"] });
  // 1 回の検査の中では同じファイルを 1 度だけ読み、コメントを消した形も 1 度だけ作る。raw と code のどちらで見るかは規則ごとに決まっている
  const memo = new Map();
  const src = (f) => {
    if (!memo.has(f)) { const raw = readFileSync(f, "utf8"); memo.set(f, { raw, code: stripLeanComments(raw) }); }
    return memo.get(f);
  };
  const findings = [];
  const add = (rule, severity, file, line, message) => findings.push({ rule, severity, file: rel(cfg.root, file), line, message });
  const ctx = { cfg, root: cfg.lean.root, modelDir, files, mainFile: join(cfg.lean.rootDir, "Main.lean"), src, add };
  for (const rule of RULES) rule(ctx);
  return { files, findings };
}

// sorry / axiom / partial / unsafe / mentions（行ごと）・walls・cqrs。Main.lean は行の規則だけに掛かる（層の外）
function perFile({ cfg, root, modelDir, files, mainFile, src, add }) {
  const allFiles = existsSync(mainFile) ? [...files, mainFile] : files;
  for (const f of allFiles) {
    const { code } = src(f);
    const relPath = rel(modelDir, f);
    const layer = relPath.split("/")[0];

    // 行の規則はコメントを消した行で見る（docstring・ブロックコメントの中の sorry / axiom は数えない）。sorry は 1 行に幾つあっても 1（status の数も同じ）
    code.split("\n").forEach((cl, i) => {
      if (/\bsorry\b/.test(cl)) add("sorry", "info", f, i + 1, "未証明（sorry）");
      if (/^\s*axiom\b/.test(cl)) add("axiom", "error", f, i + 1, "axiom は禁止（矛盾の混入経路）");
      if (/^\s*(private\s+|protected\s+)?partial\s+def\b/.test(cl)) add("partial", "warn", f, i + 1, "partial def（停止性が示せない再帰）");
      if (/^\s*unsafe\s+def\b/.test(cl)) add("unsafe", "error", f, i + 1, "unsafe は禁止");
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
      const writeSide = isUseCaseDir && (existsSync(join(dir, "Command.lean")) || existsSync(join(dir, "Observation.lean")));
      const readSide = isUseCaseDir ? existsSync(join(dir, "QueryService.lean")) && !writeSide
        : ["ReadModel.lean", "View.lean", "Ordering.lean"].includes(basename(f));
      const allowed = cfg.lean.entityImportAllow.some(a => relPath === a || relPath.startsWith(a.replace(/\/$/, "") + "/"));
      if (readSide && !allowed) {
        for (const i of importsAny("Domain.Entity")) add("cqrs", "error", f, 1, `読み取り側が Domain.Entity を import (${i}) — 読むのは Row だけ`);
      }
    }
  }
}

// actorContext: フィールド 0 の印。印と structure の切れ目（字下げの無い次の行。行頭の -- も切れ目）は元の文面で探し、フィールドはコメントを消して数える
function actorContext({ files, src, add }) {
  for (const f of files) {
    const { raw } = src(f);
    const re = /@\[actorContext\]\s*\n\s*structure\s+(\w+)[^\n]*\n([\s\S]*?)(?=\n\S|$)/g;
    let m;
    while ((m = re.exec(raw))) {
      const body = stripLeanComments(m[2]);
      const fields = (body.match(/^\s+\w+\s*:/gm) ?? []).length;
      if (fields === 0) add("actor", "error", f, raw.slice(0, m.index).split("\n").length, `@[actorContext] の ${m[1]} にフィールドが無い — 印だけの型は名義にしない`);
    }
  }
}

// annot / json: 印の置き場と deriving（元の文面で見る）
function annotJson({ modelDir, files, src, add }) {
  for (const f of files) {
    const { raw } = src(f);
    const relPath = rel(modelDir, f);
    const layer = relPath.split("/")[0];
    for (const m of raw.matchAll(/@\[aggregateRoot\]/g)) if (!relPath.startsWith("Domain/Entity/")) add("annot", "error", f, raw.slice(0, m.index).split("\n").length, "@[aggregateRoot] は Domain/Entity/ の具体構造体にだけ付ける");
    for (const m of raw.matchAll(/@\[repositoryState\]\s*\n\s*structure\s+(\w+)/g)) if (!/(RepositoryState|IdGeneratorState)$/.test(m[1])) add("annot", "error", f, raw.slice(0, m.index).split("\n").length, `@[repositoryState] の ${m[1]} は <Root>RepositoryState か <X>IdGeneratorState の名前にする（生成器の命名規約）`);
    if (layer === "Domain" || layer === "Application") {
      for (const m of raw.matchAll(/deriving[^\n]*\b(ToJson|FromJson)\b/g)) add("json", "error", f, raw.slice(0, m.index).split("\n").length, "仕様層で ToJson / FromJson を deriving しない — Runtime/Json.lean が後付けする");
    }
  }
}

// wiring: 合併型（Command / Observation）の構成子 ↔ Json.lean ↔ Machine.lean の腕（applyCommand / applyObservation）
function wiring({ cfg, modelDir, mainFile, src, add }) {
  const jsonFile = join(modelDir, "Runtime", "Json.lean");
  const machFile = join(modelDir, "Runtime", "Machine.lean");
  // 無ければ空。どちらもコメントを消した形で見る（文字列リテラルは残るので、コメントに残した古い "<構成子>" をワイヤ形式に数えない）
  const jsonText = existsSync(jsonFile) ? src(jsonFile).code : "";
  const machText = existsSync(machFile) ? src(machFile).code : "";
  const wire = (file, union, applyName) => {
    const { code } = src(file);
    const block = code.match(new RegExp(`inductive\\s+${union}\\b[\\s\\S]*?(?=\\n(?:deriving|end|def|structure|inductive|theorem)\\b|$)`));
    const ctors = block ? [...block[0].matchAll(/^\s*\|\s*(\w+)/gm)].map(m => m[1]) : [];
    // 腕は applyCommand / applyObservation のブロックの中だけを見る（同名の構成子を別の腕で数えない）
    const arms = machText.match(new RegExp(`def\\s+\\S*${applyName}\\b[\\s\\S]*?(?=\\n(?:def|theorem|end|structure|inductive)\\b|$)`))?.[0] ?? "";
    for (const c of ctors) {
      if (jsonText && !jsonText.includes(`"${c}"`)) add("wiring", "error", jsonFile, 1, `構成子 ${c} のワイヤ形式（"${c}"）が Json.lean に無い`);
      if (machText && !new RegExp(`\\.${c}\\b`).test(arms)) add("wiring", "error", machFile, 1, `構成子 ${c} の腕が Machine.lean の ${applyName} に無い`);
    }
  };
  const cmdFile = join(modelDir, "Runtime", "Command.lean");
  const obsFile = join(modelDir, "Runtime", "Observation.lean");
  if (existsSync(cmdFile)) {
    wire(cmdFile, "Command", "applyCommand");
    // 利用者の操作の合併型に内部入力を混ぜない（通知・契機は Runtime/Observation.lean）
    for (const m of src(cmdFile).code.matchAll(/^\s*\|\s*(\w+)[^\n]*\bObservation\b/gm)) add("wiring", "error", cmdFile, 1, `構成子 ${m[1]} が内部入力（Observation）を運んでいる — 利用者の操作の合併型に通知・契機を混ぜない（Runtime/Observation.lean に置く）`);
  }
  if (existsSync(obsFile)) {
    wire(obsFile, "Observation", "applyObservation");
    for (const m of src(obsFile).code.matchAll(/^\s*\|\s*(\w+)[^\n]*\bCommand\b/gm)) add("wiring", "error", obsFile, 1, `構成子 ${m[1]} が利用者の操作（Command）を運んでいる — 内部入力の合併型に利用者の操作を混ぜない（Runtime/Command.lean に置く）`);
  }
  // 内部入力の UseCase があるなら Runtime/Observation.lean が要る（Runtime の境界を持つプロジェクトだけ）
  const ucDir = join(modelDir, "Application", "UseCase");
  const hasObservationUseCase = existsSync(ucDir) && readdirSync(ucDir).some(n => existsSync(join(ucDir, n, "Observation.lean")));
  if (hasObservationUseCase && existsSync(cmdFile) && !existsSync(obsFile)) add("wiring", "error", obsFile, 1, "Observation 形の UseCase があるのに Runtime/Observation.lean（内部入力の合併型。Command とは混ぜない）が無い");
  // 外部能力の配線は揃って要る — Port の置き場があるなら環境（Runtime/Environment.lean）、環境があるなら CLI（Main.lean）の cmd external、その逆も
  const envFile = join(modelDir, "Runtime", "Environment.lean");
  const hasEnv = existsSync(envFile);
  if (!hasEnv && ["Application", "Domain"].some(l => existsSync(join(modelDir, l, "Port")))) add("wiring", "error", envFile, 1, "Port の置き場（Application/Port か Domain/Port）があるのに Runtime/Environment.lean（外部能力の script と cursor）が無い");
  if (existsSync(mainFile)) {
    const mainExternal = src(mainFile).code.includes('"external"');
    if (hasEnv && !mainExternal) add("wiring", "error", mainFile, 1, "Runtime/Environment.lean があるのに Main.lean が cmd external を受けない — 移行が半分（骨格の Main.lean で敷き直す。cradle doctor が差を出す）");
    if (!hasEnv && mainExternal) add("wiring", "error", envFile, 1, "Main.lean が cmd external を受けるのに Runtime/Environment.lean が無い — 移行が半分");
  }
  // 環境のワイヤ形式（{"port","operation",…}）: 外部能力の往復を運ぶプロジェクトでは、Port の操作ごとに両方の文字列が Json.lean に要る
  if (hasEnv) {
    for (const p of ports(cfg)) for (const o of p.operations) {
      const missing = [`"${p.name}"`, `"${o.method}"`].filter(lit => !jsonText.includes(lit));
      if (missing.length) add("wiring", "error", jsonFile, 1, `Port の往復 ${p.name}.${o.method} のワイヤ形式（${missing.join(" と ")}）が Json.lean に無い`);
    }
  }
}

// usecase: ディレクトリの形と固定名（ディレクトリは readdirSync の順のまま）
function usecase({ modelDir, src, add }) {
  const ucDir = join(modelDir, "Application", "UseCase");
  if (!existsSync(ucDir)) return;
  for (const name of readableEntries(ucDir)) {
    const d = join(ucDir, name);
    if (!statSync(d).isDirectory()) continue;
    const has = (f) => existsSync(join(d, f));
    const read = (f) => src(join(d, f)).code;
    const write = has("Command.lean"), observe = has("Observation.lean"), readSide = has("QueryService.lean");
    if (!has("UseCase.lean")) { add("usecase", "error", d, 1, `${name}/ に UseCase.lean が無い`); continue; }
    if ([write, observe, readSide].filter(Boolean).length !== 1) add("usecase", "error", d, 1, `${name}/ は Command.lean（更新系）・Observation.lean（内部入力）・QueryService.lean（参照系）のどれか 1 つだけを持つ`);
    if (readSide && !has("ReadModel.lean")) add("usecase", "error", d, 1, `${name}/ は参照系なのに ReadModel.lean が無い`);
    const uc = read("UseCase.lean");
    if (observe && /\bActorContext\b/.test(uc)) add("usecase", "error", join(d, "UseCase.lean"), 1, "内部入力（Observation）の UseCase が名義（ActorContext）を受けている — 通知・worker からの入力に利用者の名義は無い");
    if (observe && /\bActorContext\b/.test(read("Observation.lean"))) add("usecase", "error", join(d, "Observation.lean"), 1, "内部入力（Observation）が名義（ActorContext）を運んでいる — 通知・worker からの入力に利用者の名義は無い");
    if (!/\bdef\s+validate\b/.test(uc)) add("usecase", "error", join(d, "UseCase.lean"), 1, "固定名 validate が無い");
    if (!/\bdef\s+execute\b/.test(uc)) add("usecase", "error", join(d, "UseCase.lean"), 1, "固定名 execute が無い");
    if (/\bdef\s+request\b/.test(uc)) {
      for (const n of ["mkRequest", "apply"]) if (!new RegExp(`\\bdef\\s+${n}\\b`).test(uc)) add("usecase", "error", join(d, "UseCase.lean"), 1, `Port を使う UseCase（request がある）なのに固定名 ${n} が無い`);
    }
    if (readSide && !/\bdef\s+query\b/.test(read("QueryService.lean"))) add("usecase", "error", join(d, "QueryService.lean"), 1, "固定名 query が無い");
  }
}

// port: 外部能力の Port は要求と観測の純データだけ（関数フィールドは持たない）。Repository は自システムの集約の取得・保存なので、Port 名にしない
function port({ modelDir, src, add }) {
  for (const layer of ["Application", "Domain"]) {
    const portDir = join(modelDir, layer, "Port");
    if (!existsSync(portDir)) continue;
    for (const name of readableEntries(portDir)) {
      const d = join(portDir, name);
      if (!statSync(d).isDirectory()) { add("port", "error", d, 1, `${layer}/Port/ の直下は Port 名のディレクトリだけ（${name} は <Port>/<操作>.lean の形にする）`); continue; }
      if (/Repository$/.test(name)) add("port", "error", d, 1, `Port 名 ${name} は Repository で終えない（Repository は自システムの集約の取得・保存）`);
      for (const f of readableEntries(d).filter(f => f.endsWith(".lean"))) {
        const file = join(d, f);
        const { code } = src(file);
        if (!/\b(structure|inductive)\s+Request\b/.test(code)) add("port", "error", file, 1, "固定名 Request（要求）が無い");
        if (!/\b(structure|inductive)\s+Outcome\b/.test(code)) add("port", "error", file, 1, "固定名 Outcome（観測）が無い");
        for (const m of code.matchAll(/^\s+\w+\s*:\s*[^\n]*→[^\n]*$/gm)) add("port", "error", file, 1, `関数フィールドを持つ（${m[0].trim()}）— Port は要求と観測の純データだけで、外部を呼ぶ関数は UseCase に渡さない`);
        for (const m of code.matchAll(/^\s*\|\s*\w+\b[^\n]*?\(\s*\w+\s*:[^)\n]*→[^)\n]*\)/gm)) add("port", "error", file, 1, `関数を引数に取る構成子がある（${m[0].trim()}）— Port は要求と観測の純データだけで、外部を呼ぶ関数は UseCase に渡さない`);
      }
    }
  }
}

// scaffold: 骨格のサンプルドメインが残っている。探索の事実（出来事の行）があるなら、形式化されるべきものがされていない
function scaffold({ cfg, add }) {
  const sample = scaffoldSampleFiles(cfg);
  const timeline = join(cfg.root, cfg.documents.ddd, "event-timeline.md");
  const events = countEvents(readText(timeline));
  if (sample.length && events) for (const f of sample) add("scaffold", "warn", f, 1, `骨格のサンプルドメイン（メモ）が残っている。documents/ddd に出来事 ${events} 件の事実があるので、lean-domain-model スキルで実ドメインに丸ごと置き換える`);
}

// orphan: ルートから import で辿れないモジュール
function orphan({ cfg, root, modelDir, files, src, add }) {
  const rootFile = join(cfg.lean.rootDir, `${root}.lean`);
  if (!existsSync(rootFile)) return;
  const seen = new Set();
  const modOf = (f) => `${root}.${rel(modelDir, f).replace(/\.lean$/, "").split("/").join(".")}`;
  const fileOf = (mod) => join(cfg.lean.rootDir, ...mod.split(".")) + ".lean";
  const stack = [rootFile];
  while (stack.length) {
    const f = stack.pop();
    if (!existsSync(f) || seen.has(f)) continue;
    seen.add(f);
    for (const m of src(f).code.matchAll(/^import\s+(\S+)/gm)) if (m[1].startsWith(root + ".")) stack.push(fileOf(m[1]));
  }
  for (const f of files) if (!seen.has(f)) add("orphan", "warn", f, 1, `${modOf(f)} は ${root}.lean から辿れない（lake build が検査しない）`);
}
