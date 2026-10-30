import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode, writeTree } from "./helpers.mjs";

const ddd = fileURLToPath(new URL("../.apm/skills/ddd/scripts/ddd.mjs", import.meta.url));

// 出来事は列 0 で始まり最初のセルが数（1 / 2.1 / 3a）の行を表をまたいで数え、字下げした行は数えない
const timeline = `# イベント時系列マップ

プロダクト: 図書の貸出

| # | ドメインイベント (過去形) | 主体 | トリガー | 備考 / 関連 |
|---|---|---|---|---|
| 1 | 本が登録された | 司書 | 登録 | |
| 2 | 本が貸し出された | 司書 | 貸出 | |
| 2.1 | 貸出が延長された | 利用者 | 延長 | |
  | 9 | 字下げした行 | | | |

## 別表

| # | ドメインイベント (過去形) | 主体 | トリガー | 備考 / 関連 |
|---|---|---|---|---|
| 3a | 本が返された | 利用者 | 返却 | |
`;
// 用語集の表 2 つ: Prettier が揃えた区切り行（| --- |）の表と、骨格と同じ |---| の表。データ行は 1 行ずつ
const glossary = `# 用語集

| 用語 | 英語 | 意味 |
| --- | --- | --- |
| 貸出 | loan | 本を利用者に渡すこと |

## 補足

| 用語 | 英語 | 意味 |
|---|---|---|
| 投稿 | postNote | メモを書くこと |
`;
const ledger = (head, rows) => `# ${head}\n\n| ID | 問い | 状況 |\n|---|---|---|\n${rows.map(([id, status]) => `| ${id} | 問い | ${status} |`).join("\n")}\n`;

test("ddd status は出来事・状況ごとの HS / UX / MQ・用語数・命名の確認待ちを JSON で出す（| --- | の区切り行も用語に数える）", (t) => {
  const root = tempProject(t, "cradle-ddd-status-");
  writeTree(root, {
    "documents/ddd/event-timeline.md": timeline,
    "documents/ddd/ubiquitous-language.md": glossary,
    "documents/ddd/hotspots.md": ledger("hotspots.md", [["HS-001", "open"], ["HS-002", "resolved"], ["HS-003", "open"]]),
    "documents/ddd/ux-review.md": ledger("ux-review.md", [["UX-001", "open"], ["UX-002", "resolved"]]),
    "documents/ddd/model-review.md": ledger("model-review.md", [["MQ-001", "open"]]),
    "documents/ddd/questions.md": "# 問い\n",
    "documents/ddd/.session": "{}\n",
    // 用語集に英語の行がある postNote と、無い closeNote
    "lean/Example/Runtime/Command.lean": "namespace Example.Runtime\ninductive Command where\n  | postNote (c : PostNoteUseCase.Command)\n  | closeNote (c : CloseNoteUseCase.Command)\nend Example.Runtime\n",
  });
  const r = runNode(ddd, ["status"], { cwd: root, env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  // terms は見出しを除いた行: Prettier の表で区切り行とデータ行の 2、|---| の表でデータ行の 1
  assert.equal(r.stdout, JSON.stringify({
    product: "図書の貸出",
    events: 4, hotspots: { open: 2, resolved: 1 },
    ux: { open: 1 }, mq: { open: 1 }, terms: 3,
    session: true, questionsPending: true, namingPending: 1, scaffoldSample: false,
  }, null, 2) + "\n");
});
