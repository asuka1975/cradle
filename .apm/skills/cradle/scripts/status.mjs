#!/usr/bin/env node
// status — プロダクトオーナー向けの現在地。パイプラインの各フェーズがどこまで来ているかを事実だけで示す。
//   status [--json]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, parseArgs, walk, rel, scaffoldSampleFiles } from "./lib.mjs";

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
if (present.length === 0) phase("探索 (DDD)", "未着手", [`${dddDir}/ が無い`], "cradle-init スキルで骨格を作り、ddd スキルで探索を始める");
else {
  const tl = read(`${dddDir}/event-timeline.md`) ?? "";
  const events = (tl.match(/^\|\s*\d+(?:\.\d+)?[a-z]?\s*\|/gm) ?? []).length;
  const hsOpen = countRows(read(`${dddDir}/hotspots.md`), "open");
  const uxOpen = countRows(read(`${dddDir}/ux-review.md`), "open");
  const mqOpen = countRows(read(`${dddDir}/model-review.md`), "open");
  const openQ = existsSync(R(`${dddDir}/questions.md`));
  phase("探索 (DDD)", events ? "進行中" : "着手済", [`出来事 ${events} 件`, `open: HS ${hsOpen} / UX ${uxOpen} / MQ ${mqOpen}`, `欠けているファイル: ${files.filter(f => !present.includes(f)).join(", ") || "なし"}`, openQ ? "questions.md が残っている（回答待ちか後片付け漏れ）" : null].filter(Boolean),
    mqOpen ? `ddd スキルで open の MQ ${mqOpen} 件を先に検証する（形式化を止めている問い）` : hsOpen ? `ddd スキルで open の HS ${hsOpen} 件を掘る` : "次の探索テーマを決める、または次フェーズへ");
}

// 2. インフラ設計
const infraDesign = cfg.documents.infraDesign;
if (!existsSync(R(infraDesign))) phase("インフラ設計", "未着手", [`${infraDesign}/ が無い`], "infra-design スキルでモデルから非機能要件と決定（INFRA-D）を導く");
else {
  const md = walk(R(infraDesign), { ext: [".md"] }).map(f => readFileSync(f, "utf8")).join("\n");
  const d = (md.match(/INFRA-D-\d+/g) ?? []).length, q = (md.match(/\|\s*INFRA-Q-\d+\s*\|/g) ?? []).length;
  phase("インフラ設計", d ? "着手済" : "骨格のみ", [`決定 INFRA-D の言及 ${d}`, `未決 INFRA-Q ${q} 件`], q ? "未決 INFRA-Q をユーザー判断で閉じる" : "—");
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

// 5. フロントエンド
if (!existsSync(R(cfg.frontend.dir))) phase("フロントエンド", "未着手", [], "画面を Lean CLI 相手に作り、人間が触って確かめる");
else {
  const src = walk(R(`${cfg.frontend.dir}/src`), { ext: [".ts", ".tsx"] });
  const tests = src.filter(f => /\.test\.tsx?$/.test(f)).length;
  phase("フロントエンド", "着手済", [`src ${src.length} ファイル（テスト ${tests}）`], "/frontend-ux-review で体験を確かめる");
}

// 6. バックエンド
if (!existsSync(R(cfg.backend.dir))) phase("バックエンド", "未着手", [], "モデルの画面確認が済んでから着手（順序）");
else {
  const gen = cfg.backend.generated.map(g => R(g)).filter(existsSync);
  const genTests = gen.flatMap(g => walk(g, { ext: [".kt"] })).filter(f => /ContractTest\.kt$/.test(f));
  const abstractNames = genTests.map(f => f.replace(/.*\//, "").replace(/\.kt$/, ""));
  const handTests = walk(R(`${cfg.backend.dir}/src/test`), { ext: [".kt"] }).map(f => readFileSync(f, "utf8")).join("\n");
  const wired = abstractNames.filter(n => new RegExp(`:\\s*${n}\\s*\\(`).test(handTests)).length;
  const impls = walk(R(`${cfg.backend.dir}/src/main`), { ext: [".kt"] }).length;
  phase("バックエンド", gen.length ? "着手済" : "生成前", [`生成物 ${gen.length ? "あり" : "なし"}`, `契約テスト 配線 ${wired}/${abstractNames.length}`, `手書き ${impls} ファイル`],
    !gen.length ? `${cfg.backend.regenerate} で生成` : wired < abstractNames.length ? `未配線の契約テスト ${abstractNames.length - wired} 件を具象クラスで繋ぐ` : "cradle regen-impact で追随漏れを確かめる");
}

// 7. E2E
if (!existsSync(R(cfg.e2e.dir))) phase("E2E（Lean × REST の一致）", "未着手", [], "バックエンド追随後に e2e-parity スキルで締める");
else {
  const fromGolden = existsSync(R(`${cfg.e2e.dir}/scenarios/from-golden.json`)) ? (JSON.parse(readFileSync(R(`${cfg.e2e.dir}/scenarios/from-golden.json`), "utf8")).flows ?? []).length : 0;
  const scenDir = R(`${cfg.e2e.dir}/scenarios`);
  const others = existsSync(scenDir) ? walk(scenDir, { ext: [".json"] }).filter(f => !f.endsWith("from-golden.json")).length : 0;
  phase("E2E（Lean × REST の一致）", "着手済", [`golden 由来の台本 ${fromGolden} 本`, `その他の台本 ${others} 本`], fromGolden ? "pnpm test で差分ゼロを確かめる" : "flows-from-golden で台本を起こす");
}

// 8. 申し送り
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
