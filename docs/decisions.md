# Cradle の設計判断

| # | 判断 | 理由 |
|---|---|---|
| 1 | 配布形式は APM パッケージ（`.apm/` 配下に instructions / skills / agents / prompts / hooks）。ターゲットは Claude Code | hooks・agents・commands は Claude Code 固有の形。`apm install` で `.claude/` に配られ、`apm pack` で plugin バンドルにもなる |
| 2 | 汎用の規約は `.claude/rules/`（Cradle が配る）に置き、プロジェクト固有の事実は `CLAUDE.md` に置く。`documents/codestyle/` を要求しない | 規約の正本を 1 か所にし、プロジェクトごとに写しが腐るのを防ぐ |
| 3 | Lean モデルだけが documents の出典 ID を持てる。ステータス語は持てない。下流のコードは ID もステータスも持たない | 形式化には出典の追跡が要るが、可変の状態を写すと腐る。撤回・実在は `cradle unslop` が機械で確かめる |
| 4 | 規約本文に日付・経緯・事故談を書かない | 規則と歴史を分ける。経緯は ai-notes |
| 5 | 決定論的な道具は Node 標準ライブラリだけで書く（依存ゼロ） | 配布先に何も入れさせない。モックアップと同じ実行系 |
| 6 | Lean CLI プロトコル（init / step / views / flow / dump、viewer / actor / today）を Cradle の標準にする | モックアップ・golden・仕様問い合わせ・E2E 台本がこの 1 本の口だけを使う |
| 7 | 骨格は「空」ではなく動く最小ドメイン付き | 導入した瞬間から lake build・CLI・モックアップ・golden-check が通る。形式化はその形を置き換える |
| 8 | golden に `<name>.request.json` を添える | 再生できない golden は回帰検査に使えない |
| 9 | hook で止めるのは「編集してはいけない場所」だけ。設計判断は止めずに促す | 止めるべきものは機械で決まる。促しは additionalContext、レビュー必須はビルド成功後の block |
| 10 | 正式ドキュメント 3 つ（event-timeline / hotspots / ubiquitous-language）の編集は `/ddd` のセッション印（`documents/ddd/.session`）がある間だけ許す。受信箱（ux-review / model-review）は常に書ける | 「スキル経由でのみ更新」を機械化する。サブエージェントの区別はできないので時間で区切る。受信箱の起票役はセッションの外で動く |
| 11 | e2e のエンジンは配らない。台本の生成器だけを配る | 画面への写しはプロジェクトごと。golden から起こせる部分だけを機械にする |
| 12 | lean2kotlin は依存として同梱しない | 生成器は別リポジトリで進化する。導入手順は backend-implement スキルの `references/gradle-wiring.md` |
| 13 | backend の ktlint 独自ルール 8 本を骨格として配る（ルールセット id `cradle`） | 字面では破れる設計上の作法（ORM の直叩き・名義の構築箇所・fake 禁止・execute だけ呼ぶ）を機械で検査する |
| 14 | 骨格に golden（最小ドメインの基本流れ）を同梱する | 導入直後から `golden-check` が意味を持つ。git は空ディレクトリを保てない |
