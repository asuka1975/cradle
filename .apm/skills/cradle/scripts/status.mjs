#!/usr/bin/env node
// status — プロダクトオーナー向けの現在地。パイプラインの各フェーズがどこまで来ているかを事実だけで示す。
//   status [--json]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, parseArgs, walk, rel, scaffoldSampleFiles, tableRows, e2eCoverage, productLine } from "./lib.mjs";

const opts = parseArgs(process.argv.slice(2), { json: "bool" });
const cfg = loadConfig();
const R = (p) => join(cfg.root, p);
const read = (p) => existsSync(R(p)) ? readFileSync(R(p), "utf8") : null;
const countRows = (text, statusRe) => text ? (text.match(new RegExp(`^\\|\\s*(?:HS|UX|MQ)-\\d+\\s*\\|.*\\|\\s*${statusRe}\\s*\\|`, "gm")) ?? []).length : 0;

const s = { project: cfg.project, phases: [] };
const phase = (name, state, facts, next) => s.phases.push({ name, state, facts, next });

// 1. 探索（DDD）
const dddDir = cfg.documents.ddd;
const files = ["event-timeline.md", "hotspots.md", "ubiquitous-language.md", "ux-review.md", "model-review.md"];
const present = files.filter(f => existsSync(R(`${dddDir}/${f}`)));
const hsOpen = countRows(read(`${dddDir}/hotspots.md`), "open");
const uxOpen = countRows(read(`${dddDir}/ux-review.md`), "open");
const mqOpen = countRows(read(`${dddDir}/model-review.md`), "open");
if (present.length === 0) phase("探索 (DDD)", "未着手", [`${dddDir}/ が無い`], "cradle-init スキルで骨格を作り、ddd スキルで探索を始める");
else {
  const tl = read(`${dddDir}/event-timeline.md`) ?? "";
  const events = (tl.match(/^\|\s*\d+(?:\.\d+)?[a-z]?\s*\|/gm) ?? []).length;
  const openQ = existsSync(R(`${dddDir}/questions.md`));
  const product = productLine(cfg);
  phase("探索 (DDD)", events ? "進行中" : "着手済", [product.value !== null && !product.placeholder ? `プロダクト: ${product.value}` : `プロダクトの一言が無い（${dddDir}/event-timeline.md 冒頭の「プロダクト:」行。ddd.mjs start --domain で書く）`, `出来事 ${events} 件`, `open: HS ${hsOpen} / UX ${uxOpen} / MQ ${mqOpen}`, `欠けているファイル: ${files.filter(f => !present.includes(f)).join(", ") || "なし"}`, openQ ? "questions.md が残っている（回答待ちか後片付け漏れ）" : null].filter(Boolean),
    mqOpen ? `ddd スキルで open の MQ ${mqOpen} 件を先に検証する（形式化を止めている問い）` : hsOpen ? `ddd スキルで open の HS ${hsOpen} 件を掘る` : "次の探索テーマを決める、または次フェーズへ");
}

// 2. インフラ設計
const infraDesign = cfg.documents.infraDesign;
if (!existsSync(R(infraDesign))) phase("インフラ設計", "未着手", [`${infraDesign}/ が無い`], "infra-design スキルでモデルから非機能要件と決定（INFRA-D）を導く");
else {
  const rows = walk(R(infraDesign), { ext: [".md"] }).flatMap(f => tableRows(readFileSync(f, "utf8")));
  const d = rows.filter(r => /^INFRA-D-\d+$/.test(r.cells[0])).length;
  // 未決 = 状況セル（その行の表の見出しにある `状況` の位置。無ければ 4 番目）が空か open / 未決 で始まる行
  const open = rows.filter(r => /^INFRA-Q-\d+$/.test(r.cells[0])).filter(r => { const i = r.columns.indexOf("状況"); const v = r.cells[i < 0 ? 3 : i] ?? ""; return !v || /^(open|未決)/.test(v); }).map(r => r.cells[0]);
  phase("インフラ設計", d ? "着手済" : "骨格のみ", [`決定 INFRA-D ${d} 件`, `未決 INFRA-Q ${open.length} 件${open.length ? `（${open.join(", ")}）` : ""}`],
    open.length ? `未決 INFRA-Q ${open.length} 件をユーザー判断で閉じる（状況列に 決着。INFRA-D-nnn）` : "—");
}

// 3. Lean モデル
if (!existsSync(cfg.lean.modelDir)) phase("Lean 実行可能仕様", "未着手", [`${cfg.lean.dir}/${cfg.lean.root}/ が無い`], "lean-domain-model スキルで初回生成");
else {
  const leanFiles = walk(cfg.lean.modelDir, { ext: [".lean"] });
  const sorry = leanFiles.reduce((n, f) => n + (readFileSync(f, "utf8").replace(/--.*$/gm, "").match(/\bsorry\b/g) ?? []).length, 0);
  const useCases = existsSync(join(cfg.lean.modelDir, "Application", "UseCase")) ? readdirSync(join(cfg.lean.modelDir, "Application", "UseCase")).length : 0;
  const goldenDir = R(cfg.lean.golden);
  const goldens = existsSync(goldenDir) ? readdirSync(goldenDir).filter(f => f.endsWith("-flow.json")).length : 0;
  const bin = existsSync(cfg.lean.bin);
  const mockup = existsSync(R(`${cfg.lean.mockup}/server.mjs`));
  // 画面の口: Runtime/Views.lean の structure Views のフィールド数。UI が汎用のまま = index.html が骨格と同一
  const viewsFile = join(cfg.lean.modelDir, "Runtime", "Views.lean");
  const viewsBody = existsSync(viewsFile) ? (readFileSync(viewsFile, "utf8").match(/^structure Views where\n([\s\S]*?)^\s*deriving/m)?.[1] ?? "") : "";
  const outlets = viewsBody.split("\n").filter(l => /^\s{2}[A-Za-z_]\w*\s*:/.test(l)).length;
  const uiFile = R(`${cfg.lean.mockup}/public/index.html`);
  // 骨格の注記が残っていれば汎用のまま（作り込みは注記をこの画面の一文に置き換える — domain-mockup スキル）
  const genericUi = existsSync(uiFile) && readFileSync(uiFile, "utf8").includes("Cradle 標準の汎用モックアップ");
  const sample = scaffoldSampleFiles(cfg);
  if (sample.length) {
    const events = (read(`${cfg.documents.ddd}/event-timeline.md`).match(/^\|\s*\d+(?:\.\d+)?[a-z]?\s*\|/gm) ?? []).length;
    phase("Lean 実行可能仕様", "骨格のサンプル", [`実ドメインは未形式化（メモのサンプル: ${sample.map(f => rel(cfg.root, f)).join(", ")}）`, `CLI ${bin ? "ビルド済" : "未ビルド（lake build）"}`],
      events ? "lean-domain-model スキルで骨格のサンプルを丸ごと置き換える" : "ddd スキルで探索する（サンプルは探索の根拠にしない）。事実が集まったら lean-domain-model スキルで置き換える");
  } else phase("Lean 実行可能仕様", "進行中", [`${leanFiles.length} ファイル / UseCase ${useCases} 件`, `sorry ${sorry}`, `golden ${goldens} 組`, `CLI ${bin ? "ビルド済" : "未ビルド（lake build）"}`, `画面の口（Views）${outlets} 個`, `モックアップ ${!mockup ? "なし" : genericUi ? "汎用 UI のまま" : "作り込み済"}`],
    !bin ? "cd lean && lake build"
      : outlets === 0 ? "lean-domain-model スキルで集約ごとの一覧の口を Views に足す（口が無いと画面でも golden でも観測できない）"
      : !mockup ? "domain-mockup スキルで仕様アニメーションを作る"
      : genericUi ? "domain-mockup スキルでドメインの語彙の画面に作り込む（口ごとの画面・対象の横のフォーム・登場人物の切り替え）"
      : goldens === 0 ? "モックアップで流れを確かめ golden を採る" : "cradle golden-check で回帰を確かめ、次フェーズへ");
}

// 4. API 契約
const openapi = cfg.documents.openapi;
if (!existsSync(R(openapi))) phase("API 契約 (OpenAPI)", "未着手", [`${openapi} が無い`], "api-contract スキルで Lean の Command/View から契約を起こす");
else {
  const y = read(openapi);
  // 骨格が置く /api/healthcheck は数えない — それしか無い契約は未着手（api-contract スキルが Lean から起こす）
  const ops = y.split(/^(?=  \/)/m).filter(b => b.startsWith("  /") && !b.startsWith("  /api/healthcheck:"))
    .reduce((n, b) => n + (b.match(/^\s{4}(get|post|put|patch|delete):/gm) ?? []).length, 0);
  const feGen = cfg.frontend.generated.some(g => existsSync(R(g)));
  if (!ops) phase("API 契約 (OpenAPI)", "未着手", ["骨格の healthcheck だけ"], "api-contract スキルで Lean の Command/View から契約を起こす");
  else phase("API 契約 (OpenAPI)", "着手済", [`操作 ${ops} 件`, `frontend 生成クライアント ${feGen ? "あり" : "なし"}`], feGen ? "—" : `frontend で ${cfg.frontend.genApi}`);
}

// 5. フロントエンド（材料: 業務の流れを止めている問いが無いこと）
const flowFact = hsOpen || mqOpen ? `open の HS ${hsOpen} / MQ ${mqOpen}（業務の流れを止めている問いがあれば先に閉じる）` : "open の HS / MQ なし";
if (!existsSync(R(cfg.frontend.dir))) phase("フロントエンド", "未着手", [flowFact], "frontend スキルで画面を業務のまとまりごとに作る（相手は Lean CLI）");
else {
  const src = walk(R(`${cfg.frontend.dir}/src`), { ext: [".ts", ".tsx"] });
  const tests = src.filter(f => /\.test\.tsx?$/.test(f)).length;
  phase("フロントエンド", "着手済", [`src ${src.length} ファイル（テスト ${tests}）`, flowFact], "/frontend-ux-review で体験を確かめる");
}

// 6. バックエンド
if (!existsSync(R(cfg.backend.dir))) phase("バックエンド", "未着手", [], "モデルの画面確認が済んでから着手（順序）");
else {
  const gen = cfg.backend.generated.map(g => R(g)).filter(existsSync);
  const genKt = gen.flatMap(g => walk(g, { ext: [".kt"] }));
  const nameOf = (f) => f.replace(/.*\//, "").replace(/\.kt$/, "");
  // Adapter の適合テスト（<Port>AdapterContractTest）は build の門の外で、配線の置き場も src/adapterTest — 契約テストとは別に数える
  const abstractNames = genKt.filter(f => /ContractTest\.kt$/.test(f) && !/AdapterContractTest\.kt$/.test(f)).map(nameOf);
  const adapterTestNames = genKt.filter(f => /AdapterContractTest\.kt$/.test(f)).map(nameOf);
  const wiredIn = (dir, names) => { const text = walk(R(`${cfg.backend.dir}/src/${dir}`), { ext: [".kt"] }).map(f => readFileSync(f, "utf8")).join("\n"); return names.filter(n => new RegExp(`:\\s*${n}\\s*\\(`).test(text)).length; };
  const wired = wiredIn("test", abstractNames);
  const adapterTestsWired = wiredIn("adapterTest", adapterTestNames);
  const handMain = walk(R(`${cfg.backend.dir}/src/main`), { ext: [".kt"] });
  const impls = handMain.length;
  // 外部能力の Port: 生成 interface（KDoc の「Lean: Port」）と、それを実装する手書きの Adapter。
  // Adapter は infrastructure/ 配下で Port を supertype に持つ型だけ（Port をコンストラクタで受ける UseCase 実装は数えない）
  const ports = genKt.flatMap(f => { const m = readFileSync(f, "utf8").match(/^ \* Lean: Port `[^`]+`[\s\S]*?^interface (\w+)/m); return m ? [m[1]] : []; });
  const withoutParens = (s) => { let out = "", depth = 0; for (const ch of s) { if (ch === "(") depth++; else if (ch === ")") depth--; else if (depth === 0) out += ch; } return out; };
  const supertypes = handMain.filter(f => /\/infrastructure\//.test(rel(cfg.root, f))).map(f => readFileSync(f, "utf8"))
    .flatMap(text => [...text.matchAll(/\b(?:class|object)\s+\w+([^{]*)\{/g)].map(m => withoutParens(m[1]).split(":").slice(1).join(":")));
  const adapters = ports.filter(p => supertypes.some(s => new RegExp(`\\b${p}\\b`).test(s)));
  const portFact = ports.length ? `Port ${ports.length} 件（Adapter ${adapters.length}${adapterTestNames.length ? `、適合テスト 配線 ${adapterTestsWired}/${adapterTestNames.length}` : ""}）` : null;
  phase("バックエンド", gen.length ? "着手済" : "生成前", [`生成物 ${gen.length ? "あり" : "なし"}`, `契約テスト 配線 ${wired}/${abstractNames.length}`, portFact, `手書き ${impls} ファイル`].filter(Boolean),
    !gen.length ? `${cfg.backend.regenerate} で生成` : wired < abstractNames.length ? `未配線の契約テスト ${abstractNames.length - wired} 件を具象クラスで繋ぐ`
      : adapters.length < ports.length ? `Adapter の無い Port ${ports.filter(p => !adapters.includes(p)).join(", ")} を infrastructure/<port>/ に書く`
      : adapterTestsWired < adapterTestNames.length ? `未配線の Adapter 適合テスト ${adapterTestNames.length - adapterTestsWired} 件を src/adapterTest/kotlin の具象クラスで繋ぎ、./gradlew adapterContractTest で回す`
      : "cradle regen-impact で追随漏れを確かめる");
}

// 7. インフラ実装（local スタック。E2E の前提）
// 投入表 = documents/infra-design/README.md の「## 投入」節の local / prod 行。セルは 未 か 済（YYYY-MM-DD）
const deploySec = (read(`${infraDesign}/README.md`) ?? "").split(/^## /m).find(s => s.startsWith("投入")) ?? "";
const deployed = (env) => deploySec.match(new RegExp(`^\\|\\s*\`?${env}\`?\\s*\\|([^|]*)\\|`, "m"))?.[1].trim() ?? null;
const deployFact = (env, v) => v === null ? "投入表が無い（README の末尾に骨格と同じ「投入」の節を足す）" : `投入表 ${env}: ${v}`;
const local = deployed("local"), prod = deployed("prod");
const hasInfra = existsSync(R(cfg.infra.dir));
phase("インフラ実装", hasInfra ? "着手済" : "未着手",
  [hasInfra ? `${cfg.infra.dir}/ ${walk(R(cfg.infra.dir)).length} ファイル` : `${cfg.infra.dir}/ が無い`, `infra.up ${cfg.infra.up ? `あり（${cfg.infra.up}）` : "未設定"}`, `infra.containers ${(cfg.infra.containers ?? []).length} 件`, deployFact("local", local)],
  !hasInfra ? "backend 追随後に infra-implement スキルで local スタックを作る"
    : !cfg.infra.up ? "cradle.json の infra.up に 1 コマンドを書く"
    : !local?.startsWith("済") ? "infra.up で立て、cradle doctor --local が fresh になったら投入表の local を済にする" : "—");

// 8. E2E
if (!existsSync(R(cfg.e2e.dir))) phase("E2E（Lean × REST の一致）", "未着手", [], "インフラ実装（local スタック）の後に e2e-parity スキルで締める");
else {
  // 台本は golden の流れに対応していて初めて数える（手書きでも、手の列が golden と同じなら対応）
  const c = e2eCoverage(cfg);
  phase("E2E（Lean × REST の一致）", "着手済", [`golden の流れ ${c.golden.length} 本 / 台本が対応 ${c.covered.length} 本（${c.place}）`, `台本 ${c.scripts} 本`],
    c.golden.length === 0 ? "モックアップで流れを確かめ golden を採る"
      : c.covered.length < c.golden.length ? "flows-from-golden --check で対応の無い流れを起こす（台本は golden から）" : "pnpm test で差分ゼロを確かめる");
}

// 9. 本番投入（E2E 合格の後）
phase("本番投入", prod?.startsWith("済") ? "投入済" : "未投入", [deployFact("prod", prod)], prod?.startsWith("済") ? "—" : "E2E 合格後、サンドボックスで一度 apply し投入表の prod を済にする");

// 10. 申し送り
const notes = existsSync(R(cfg.documents.aiNotes)) ? readdirSync(R(cfg.documents.aiNotes)).filter(f => f.endsWith(".md")).length : 0;
s.aiNotes = notes;

if (opts.json) console.log(JSON.stringify(s, null, 2));
else {
  console.log(`# ${cfg.project} — Cradle status\n`);
  for (const p of s.phases) {
    console.log(`## ${p.name} — ${p.state}`);
    for (const f of p.facts) console.log(`- ${f}`);
    if (p.next && p.next !== "—") console.log(`→ 次: ${p.next}`);
    console.log();
  }
  console.log(`申し送り（${cfg.documents.aiNotes}）: ${notes} 件 — 規約ではない。ユーザー判断が要るものが無いか確かめる。`);
}
