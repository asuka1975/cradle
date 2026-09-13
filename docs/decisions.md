# Cradle の設計判断

| # | 判断 | 理由 |
|---|---|---|
| 1 | 配布形式は APM パッケージ（`.apm/` 配下に instructions / skills / agents / hooks）。ターゲットは Claude Code と Codex | hooks は両者で同じ stdin / stdout。agents は APM が Codex の toml に写し、rules は Codex では AGENTS.md に compile される。`apm pack` で Claude Code の plugin バンドルにもなる |
| 2 | 汎用の規約は Cradle が配る rules（Claude Code `.claude/rules/`、Codex AGENTS.md）に置き、プロジェクト固有の事実は消費側の `.apm/instructions/project.instructions.md` に置く。`CLAUDE.md` も `documents/codestyle/` も要求しない | 規約の正本を 1 か所にし、プロジェクトごとに写しが腐るのを防ぐ。固有の事実は Claude Code では `apm install` が rules に、Codex では `apm compile` が AGENTS.md に写す（`apm compile` は CLAUDE.md しか書かず、rules が既にあると何も出さない。Codex はルートの AGENTS.md を compile が書き換えるので手書きにできない） |
| 3 | Lean モデルだけが documents の出典 ID を持てる。ステータス語は持てない。下流のコードは ID もステータスも持たない | 形式化には出典の追跡が要るが、可変の状態を写すと腐る。撤回・実在は `cradle unslop` が機械で確かめる |
| 4 | 規約本文に日付・経緯・事故談を書かない | 規則と歴史を分ける。経緯は ai-notes |
| 5 | 決定論的な道具は Node 標準ライブラリだけで書く（依存ゼロ） | 配布先に何も入れさせない。モックアップと同じ実行系 |
| 6 | Lean CLI プロトコル（init / step / views / flow / dump、viewer / actor / today）を Cradle の標準にする | モックアップ・golden・仕様問い合わせ・E2E 台本がこの 1 本の口だけを使う |
| 7 | 骨格は「空」ではなく動く最小ドメイン付き | 導入した瞬間から lake build・CLI・モックアップ・golden-check が通る。形式化はその形を置き換える |
| 8 | golden に `<name>.request.json` を添える | 再生できない golden は回帰検査に使えない |
| 9 | hook で止めるのは「編集してはいけない場所」だけ。設計判断は止めずに促す | 止めるべきものは機械で決まる。促しは additionalContext、レビュー必須はビルド成功後の block |
| 10 | 正式ドキュメント 3 つ（event-timeline / hotspots / ubiquitous-language）の編集は `/ddd` のセッション印（`documents/ddd/.session`）がある間だけ許す。受信箱（ux-review / model-review）は常に書ける | 「スキル経由でのみ更新」を機械化する。サブエージェントの区別はできないので時間で区切る。受信箱の起票役はセッションの外で動く |
| 11 | e2e のエンジンは配らない。台本の生成器だけを配る | 画面への写しはプロジェクトごと。golden から起こせる部分だけを機械にする |
| 12 | 生成器 lean2kotlin はこのリポジトリの `lean2kotlin/` に置く（ビルドは分ける）。利用側は apm が配った写し（`apm_modules/<owner>/cradle/lean2kotlin`）を composite build で参照し、別のチェックアウトは `LEAN2KOTLIN_HOME` で指す | skill・rules・骨格・ktlint ルールは生成器が何を出すかを前提に書かれていて、生成器が変われば同時に変わる。版の歴史を 1 本にすると生成器の直しが Cradle の版上げで届く。配線は backend-implement スキルの `references/gradle-wiring.md` |
| 13 | backend の ktlint 独自ルール 8 本を骨格として配る（ルールセット id `cradle`） | 字面では破れる設計上の作法（ORM の直叩き・名義の構築箇所・fake 禁止・execute だけ呼ぶ）を機械で検査する |
| 14 | 骨格に golden（最小ドメインの基本流れ）を同梱する | 導入直後から `golden-check` が意味を持つ。git は空ディレクトリを保てない |
| 15 | 散文にターゲット固有のパス（`.claude/…`）を書かない。道具は `cradle <command>`、スキルと規約は名前だけ。置き場の対応（`<skills>`、`/名前` と `$名前`）は cradle-core 規則の 1 か所 | Claude Code と Codex で配置先が違う（`.claude/skills` と `.agents/skills`）。写せば片方で腐る |
| 16 | hook のコマンドは自分の置き場（`.claude/skills` か `.agents/skills`）を祖先へ辿って探してから `hook.mjs` を呼ぶ | Codex の hook には `CLAUDE_PROJECT_DIR` が無く環境も空。APM は hooks を両ターゲットへ同じ文字列で写す |
| 17 | Codex は `apm compile --single-agents` で 1 枚の AGENTS.md にし、骨格の `.codex/config.toml` が `project_doc_max_bytes` を上げる | Codex は起動時にルートから cwd までの AGENTS.md しか読まない（ディレクトリ別の AGENTS.md はルートでの作業中に見えない）。規約は既定の上限 32 KiB を超え、超過分は黙って切られる |
| 18 | `cradle-status` は prompt ではなく skill として配る | APM は prompts を Codex に配らない。skill は両方に配られ、`/cradle-status` と `$cradle-status` が同じ振る舞いになる |
| 19 | Codex 向けの agent は `tools` を落として配られる（APM の警告どおり）。書き換えないことは本文の指示で担保する | Codex の agent 定義に tools は無い。Claude Code では tools 制限を残す |
| 20 | Claude Code の `ask`（止めて人間に聞く）は Codex に無いので、そこでは additionalContext で促して続けさせる | Codex は未知の permissionDecision を無視して通す。促しは失われず、止める判断は「編集してはいけない場所」だけに限る（#9） |
| 21 | Lean CLI は非同期の `spawn` で呼び、stdin を流してから閉じる | Codex のサンドボックスでは `spawnSync` に `input` を渡すと EOF が届かず、`cat` でも固まる。golden-check・spec-query・smoke が全部この 1 本を通る |
| 22 | `ddd.mjs end` は同じ版の questions.md に `answers` を中継した後でだけ通る（`.session` に問いの版と中継の記録を持つ）。問いを捨てるのは `--abandon` だけ | 探索役が回答を受け取らないまま片付けた事故を機械で止める。hook も Codex の探索役（agent_type）が ddd.mjs・questions.md・.session に触るのを止める |
| 23 | 骨格を敷く道具は書けない場所があっても止まらず、残りを敷いてから書けなかった一覧を出す | Codex のサンドボックスでは `.codex/` が書けない。途中で落ちると据え置きの判定が効かず、再実行の手間が増える |
| 24 | 骨格のサンプルドメイン（メモ）はコメントのマーカーで機械検出し、`cradle status`・`ddd.mjs start`・`lean-check` が「実ドメインではない」と言う。サンプルの間は questions.md にモックアップ欄を出さず、探索役は `lean/` を読まない | 探索役が `lean/` のサンプルを「現在のモデル」と信じて問いを組み立てた。散文の注意書きより、状態を機械が言うほうが確実 |
| 25 | 骨格の汎用 UI は Lean の Command 構造体の型（`spec-query schemas`）から入力欄を生成し、列名と操作名を用語集（英語候補 → 用語）で引く。判断は持たない | JSON を手で書く UI ではエキスパートがモデルをレビューできない。型と用語集は既にある事実で、UI にロジックを足さずに読める化できる |
| 26 | domain-mockup の作り込み（口ごとの画面・対象の横のフォーム・登場人物の切り替え）は任意ではなく必須の成果物。骨格を敷き直すのは `server.mjs` だけで、作り込んだ `index.html` が正本 | 汎用 UI は「動く」が「読める」ではない。MonoWa で見やすかったのは作り込みを必須にしていたから |
| 27 | `Views` は集約ごとに一覧の口を必ず持つ。閲覧の可否が未決でも口は作り、未決の部分は全件にして MQ を起票する | 口が無いモデルは仕様アニメーションでも golden でも何も観測できない（sophos で Views が空になった） |
| 28 | 撤回は状態列で表す（HS の状態 `撤回`、UX / MQ の `却下`）。状態列の無い表（出来事・INFRA-D / A）は最後の列の先頭 `撤回:` だけが撤回。`lean-ref-retracted` はそこだけを見る | 本文に「撤回」「却下」が出る業務（招待の撤回・申請の却下）は普通にあり、行全体の grep は現役の出典を撤回済みと言う。状態列は既に機械可読。同じ理由で `撤回` を comment-status の語彙には入れない |
| 29 | INFRA-Q の状況列は、空か `open` / `未決` で始まる行だけを未決と数える。INFRA-D は決定表の行数 | 行を消さない規約のもとで、閉じた問いを数え続けないため。状態語を 1 つ覚えれば済む |
| 30 | モデルが付けた名前（コマンド・失敗・画面の口）は、用語集に行が立つまで `cradle unslop` が列挙し、`ddd.mjs start` が一時ファイル `naming.md` に写して探索セッションでエキスパートが確定する。受信箱の表は持たない | 用語集を唯一の正本のまま戻り路を作る。手書きの受信箱は起票の手間と写しの腐りを生む |
| 31 | インフラ実装は独立フェーズ（infra-implement）。local スタックは E2E の前提、本番の apply は E2E 合格の後。投入した事実は設計文書の投入表に持つ。IaC のモジュールは配らない | 設計だけあって工程が無いと、local が無いまま E2E に進み、本番が一度も apply されないまま終われる。各フェーズが入口・成果物・ゲートを持つ型に揃える |
| 32 | フロントエンドの入口は frontend スキル。画面の単位は業務のまとまり（主体がひと続きで終わらせる仕事）で、集約ごとでもコマンドごとでもない | 直前のモックアップ（口ごと・コマンドごと）が唯一の手本になり、フロントエンドがモックアップの写しになる |
| 33 | 人が打つ表記と内部表現が違う値は `Runtime/Json.lean` の手書き `FromJson` が文字列 1 本を受け、その docstring を `spec-query schemas` が欄の注記（`hint`）にする。`ToJson` は変えない | 型から起こした欄は内部表現を打たせる。ワイヤの形の出どころを `Json.lean` の 1 か所に寄せ、UI に型名の特別扱いを書かせない |
| 34 | 生成器の回帰は、生成器の単体テスト（Lean 不要）と、骨格を生成器に通す `lean2kotlin/scaffold-check`（InMemory 実装で契約テストを通し、生成物をスナップショットとしてコミット）で見る。サンプルプロジェクトは持たない | 骨格が唯一の例示ドメインになり、同じ事実を 2 か所に持たない。統合テストをサンプルに詰め込むと検査の置き場が分からなくなる |
| 35 | Pi/OpenCodeの追加統合は既存の決定論的CLIを無変更で呼び出す。OpenCode SDKは `integrations/opencode` だけの実行時依存、jitiとTypeScriptは検証用の開発依存とする | 既存のClaude/Codexの動作とCLIの依存ゼロを維持し、OpenCodeを使わない利用者へSDKの導入を要求しない。詳細は [統合手順](integrations.md) |
| 36 | `ddd.mjs start` は `lean/` の sha256 を `.session` に記録し、`ddd.mjs end` は `ddd-clean-check --baseline .session` でその時点と比べる（HEAD とは比べない）。`.session` は検査が通るまで残し（その間 hook は `documents/ddd/` の編集を許したまま）、印が残ったままの `start` は止める。スキルにコミット手順は足さない | 前回の形式化（フェーズ 2）が未コミットのまま探索を始めると、HEAD 比較では触っていない `lean/` が差分として出て `end` が通らない。コミットのタイミングはホストの方針に委ねる。記録を検査の前に消すと、残骸を片付けて `end` をやり直す時に同じ誤検知へ戻る |
| 37 | 集約ルートが大域的に満たす制約（一意性）は `<Root>RepositoryState` の Prop フィールド（`(coll.map (·.f)).Nodup` / `(coll.filterMap (·.f)).Nodup`）で書き、構築時に保証させる。抽出器はそれを IR の `constraints` に出し、Repository 契約テストの fixture はその制約を満たす個体の列を引く。泉の新鮮性は UseCase が Prop 引数で受け（境界は `Snapshot.check` から作る）、入力に依る証拠（題が空いていること）は validate が Prop フィールドだけの structure を解決の成果物として返す。重複する状態は境界の `FromJson` が弾く | Bool の `valid` は生成器に読まれず、実 DB の一意制約に配線した契約テストが fixture の衝突で決定的に赤くなる。制約の正本を構造体の 1 か所にすれば、`valid` と生成器の変位規則の 2 か所に分かれない |
