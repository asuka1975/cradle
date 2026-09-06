# Cradle — Lean 仕様駆動開発のハーネス

**仕様はハーネスである。ハーネスは決定論的であるべきである。だから Lean で書かれた仕様は効果的なハーネスになる。**

Cradle は、プロダクトオーナーがゆりかごに身を任せるようにプロダクトの開発を最後までやりきるための、
Claude Code と Codex 向けの配布可能なハーネス（[Microsoft APM](https://github.com/microsoft/apm) パッケージ）。
探索（イベントストーミング）→ インフラ設計 → Lean 実行可能仕様 → 仕様アニメーション → API 契約 → フロントエンド → 人間による確認 → バックエンド → E2E の
一方向のパイプラインと、それを守る規約・スキル・エージェント・hook・決定論的な道具を配る。

## 何が入っているか

| 種類 | 中身 |
|---|---|
| rules（常時） | 芯（順序・正本・道具）、documents、コメント、unslop、生成物、Lean、backend（実装・設計品質）、frontend、API 契約、infra、e2e |
| skills | `cradle`（status / golden-check / lean-check / regen-impact / unslop）、`spec-query`（Lean を動かして仕様に答える）、`cradle-init`、`ddd`、`lean-domain-model`、`domain-mockup`、`infra-design`、`api-contract`、`backend-implement`、`regen-impact`、`e2e-parity`、`frontend-ux-review`、`sql-perf-review`、`backend-design-review`、`unslop` |
| agents | `ddd-domain-explorer`、`ddd-ux-reviewer`、`lean-domain-modeler`、`frontend-ux-reviewer`、`sql-performance-reviewer`、`backend-design-reviewer`、`unslop-reviewer` |
| hooks | 生成物・人間専用領域・golden・探索ドキュメントへの直接編集を止める / ビルド成功後にレビューを促す / 止まる前に unslop の error を差し戻す |
| 骨格 | `cradle.json`、documents のテンプレート、動く最小ドメイン付きの Lean 実行可能仕様（CLI・モックアップ・golden がその場で通る。モックアップは型から入力欄を、用語集から表示名を作る）、CI ワークフロー、backend の ktlint 独自ルール（設計上の作法を検査する 8 本） |

## 導入

```bash
curl -sSL https://aka.ms/apm-unix | sh          # APM CLI
cd <your-product>
printf 'name: my-product\nversion: "0.1.0"\ntargets:\n  - claude\ndependencies:\n  apm: []\n' > apm.yml   # Codex なら - codex（両方でもよい）
apm install asuka1975/cradle#v0.1.0-alpha.6      # タグで固定する
apm compile --single-agents                      # Codex: 規約を 1 枚の AGENTS.md にする（Claude Code では不要）
```

| | Claude Code | Codex |
|---|---|---|
| 配られる場所 | `.claude/rules` `.claude/skills` `.claude/agents` `.claude/settings.json`（hooks） | `AGENTS.md`（compile）`.agents/skills` `.codex/agents` `.codex/hooks.json` |
| スキルの呼び方 | `/cradle-init` | `$cradle-init` |

```
cradle-init --project MyProduct      # 骨格を敷く（cradle.json, .apm/instructions/project.instructions.md, documents/, lean/）
apm compile [--single-agents]        # 固有の事実を rules / AGENTS.md に写す
cd lean && lake build
cradle-status                        # 現在地
ddd                                  # 探索を始める
```

Codex はプロジェクトを「信頼」したときだけ `.codex/`（hooks・agents・設定）を読み、hooks は起動時のレビューで信頼したものだけが動く。骨格が置く `.codex/config.toml` は AGENTS.md の読込上限（既定 32 KiB）を上げる。

要件: Node 20+、elan / lake（Lean 4）、JDK 21（backend）、pnpm（frontend）。生成器 [lean2kotlin](https://github.com/asuka1975/lean2kotlin) は backend フェーズで使う。

## 決定論的な道具

| コマンド | 何を確かめるか |
|---|---|
| `cradle status` | フェーズごとの事実と次の一手 |
| `cradle spec-query run …` | この状況でこの手を打ったらモデルは何と言うか |
| `cradle golden-check` | モデルを変えて、変えるつもりのなかった流れが変わっていないか |
| `cradle lean-check` | 層の壁・sorry・axiom・生成器への言及 |
| `cradle regen-impact` | 再生成で変わった生成シンボルと、それを参照する手書き実装・契約テスト |
| `cradle unslop` | コメント規約・腐ったパス・逃げ言葉・握りつぶし |
| `cradle ddd-clean-check` | 探索の残骸 |
| `cradle doctor` | 道具の有無と版 |
| `contract-check`（api-contract スキル） | Lean のコマンド・画面と openapi の操作が 1 対 1 か |
| `flows-from-golden`（e2e-parity スキル） | golden から E2E の台本 |

すべて `node <skills>/cradle/scripts/cradle.mjs <command>`（`<skills>` は Claude Code `.claude/skills` / Codex `.agents/skills`）。

## ドキュメント

- [docs/concept.md](docs/concept.md) — 思想と、ハーネスが決定論的であるとはどういうことか
- [docs/pipeline.md](docs/pipeline.md) — フェーズ・成果物・ゲート
- [docs/adopting.md](docs/adopting.md) — 新規 / 既存プロジェクトへの導入
- [docs/decisions.md](docs/decisions.md) — Cradle 自身の設計判断
- [docs/monowa-improvements.md](docs/monowa-improvements.md) — 監査で見つけた MonoWa の改善点（パスは monowa リポジトリ基準）
- [Lean CLI プロトコル](.apm/skills/cradle/references/protocol.md)
- [cradle.json（設定）](.apm/skills/cradle/references/cradle-json.md)

## 開発

```bash
apm compile --validate            # 構造検査
apm install --dry-run --target claude
apm install --dry-run --target codex
apm pack                          # Claude Code plugin 形式のバンドル（残る .claude-plugin/ と build/ は消す。残っていると local install が plugin 扱いになり skills が配られない）
```

## ライセンス

Copyright (c) 2026 asuka1975

Cradle は GNU General Public License v3.0 の下で配布する。全文は [LICENSE](LICENSE)。

このプログラムは自由ソフトウェアであり、Free Software Foundation が公開した GNU General Public License の第 3 版の条件の下で再配布・改変できる。
このプログラムは有用であることを願って配布されるが、商品性や特定目的への適合性の暗黙の保証を含め、いかなる保証も無い。
