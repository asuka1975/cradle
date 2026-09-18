# Lean 記述規約と骨格例

cradle-init スキルが敷く最小ドメイン（メモを書く・閉じる・一覧）の形がそのまま規約の実例。例はその語彙で書く。

## 1. 基本方針

- `axiom` / `unsafe` 禁止。ドメインは inductive / structure / def で「構成」する。`partial` は避ける（fold / map / filter で全域に）。
- 証明のグラデーション: omega / simp / decide / grind → 手証明 → `sorry` + `-- TODO(proof): 理由`。sorry は証明の未完にだけ使う。
- 述語は `Bool` を返す関数か `Decidable` が付く形にする（`decide` が効く・`#guard` で固定できる）。
- 出典参照（`[HS-xxx]` `[イベント#n]`）は実在する記述に限る。定理の docstring は自然言語の記述を全文で持つ（タグだけにしない）。
- 依存はゼロ（Lean core のみ）。mathlib は入れない。
- 仕様層（Domain / Application）で `ToJson` / `FromJson` を deriving しない。ワイヤ形式は境界（`Runtime/Json.lean`）の契約。人が打つ表記が内部表現と違う VO は、境界の手書き `FromJson` が文字列 1 本を受ける（`ToJson` は変えない）。

## 2. 値の市民（`Domain/ValueObject.lean`）

- ドメイン状態が運ぶ値だけが VO。入力専用の語彙はコマンドの持ち物（`UseCase/<X>/Command.lean`）。
- 1 VO = フィールド + 制約（`valid : Bool`）+ `@[contract]` 定理（制約の特徴付け・境界値）。制約の実値にはドメインの裏付けが要る（「機械的常識」も勝手に足さない。未探索は未探索と書く）。
- 型が構築時に保証する制約に valid を書かない（暦の実在は `Std.Time.PlainDate` が保証。リテラルは `date("2026-01-01")`）。
- 同一性の VO（各 ID）は各 Entity の持ち物で、表現は型パラメータで抽象のまま。具体表現は `Runtime/Ids.lean` の仮置きで、決定は NFR（インフラ設計）。

```lean
structure Title where text : String deriving Repr, DecidableEq, Inhabited
def Title.valid (t : Title) : Bool := decide (0 < t.text.length)
@[contract] theorem Title.valid_iff (t : Title) : t.valid = true ↔ 0 < t.text.length := by simp [Title.valid]
```

## 3. Entity（`Domain/Entity/`）

具体構造体（ルートは `@[aggregateRoot]`）+ ふるまいの def + `@[contract]` 定理群を 1 ファイルに。

```lean
@[aggregateRoot]
structure Note (NoteId UserId : Type) where
  id : NoteId
  author : UserId
  title : Title
  closed : Bool
deriving Repr, DecidableEq

def Note.post (id : NoteId) (author : UserId) (title : Title) : Note NoteId UserId := { id, author, title, closed := false }
def Note.close (n : Note NoteId UserId) : Note NoteId UserId := { n with closed := true }

@[contract] theorem Note.close_id (n : Note NoteId UserId) : n.close.id = n.id := rfl          -- 同一性
@[contract] theorem Note.close_closed (n : Note NoteId UserId) : n.close.closed = true := rfl   -- 効果
@[contract] theorem Note.close_frame (n : Note NoteId UserId) : n.close.author = n.author ∧ n.close.title = n.title := ⟨rfl, rfl⟩ -- 非効果
@[contract] theorem Note.close_idem (n : Note NoteId UserId) : n.close.close = n.close := rfl   -- 冪等
```

- 大域状態を署名に置かない。単位は機能ではなく Entity。同一性・効果・非効果・冪等を別々の定理にする（1 定理 1 概念）。
- 非ルート Entity は Repository・UseCase を持たない（ルート経由でのみ変わることが構文的保証）。
- 法則が要求しない観測は署名に置かない。含めない法則・操作はコメントで宣言する。
- DomainService = 複数の集約ルートへの関心が要る業務ルールだけ。1 件に閉じるならルートのふるまい、1 UseCase にしか現れないなら UseCase の仕様。置き場は `Domain/DomainService/<名前>.lean` で 1 ファイル = 1 interface（Kotlin 名は `<名前>Service`）。

## 4. 更新系 UseCase（`Application/UseCase/<X>UseCase/`）

観測モデル（`Application/RepositoryState.lean`）は Repository の論理状態。表現はリスト（並びが業務の情報）。集約の個体は `<Root>RepositoryState` の 1 本の `List` に全部入る — 「進行中は高々 1 件」「決着した個体はアーカイブ」のような生存期間の区別は、`Option` の現在枠や 2 本目の `List` ではなく、その列に掛かる制約と `find?` 系の射影で表す。
集約ルートが大域的に満たす制約は構造体の Prop フィールドで、構築時に保証される（`uniqueIds : (notes.map (·.id)).Nodup`、`uniqueTitles : (notes.map (·.title)).Nodup`。`Option` のフィールドで値のある個体だけの一意性なら `(coll.filterMap (·.f)).Nodup`。全件が満たす条件は `∀ x ∈ coll, x.f = c`、件数の上限は `(coll.filter p).length ≤ n`）。

```lean
-- 生成器の回帰素材（来訪受付）の例: 受付中の来訪は高々 1 件
@[repositoryState]
structure VisitRepositoryState (VisitId EmployeeId : Type) where
  visits : List (Visit VisitId EmployeeId)
  uniqueIds : (visits.map (·.id)).Nodup
  atMostOneExpected : (visits.filter (fun v => v.phase != .left)).length ≤ 1

def VisitRepositoryState.find? [DecidableEq VisitId] (s : VisitRepositoryState VisitId EmployeeId) (id : VisitId) : Option (Visit VisitId EmployeeId) :=
  s.visits.find? (fun v => v.id == id)
def VisitRepositoryState.vacant (s : VisitRepositoryState VisitId EmployeeId) : Bool :=
  decide ((s.visits.filter (fun v => v.phase != .left)).length = 0)
```

点更新は `update`（同一性も題も変えない f とその証明）、追加は `add`（末尾。新鮮な同一性と空いている題の証明）。消す操作は無い。生成器は Repository の `add` / `update` をこの観測モデルの操作から導く。ID の泉は `Fountain σ α`（値型と生成器状態は抽象、具体化は Runtime）。
`add` が要る証明の出どころは 2 つ: 泉から汲む同一性の新鮮性 `fountain.Fresh before.noteIds before.notes.ids` は UseCase が Prop 引数で受ける（境界は `Snapshot.check` から作る）。
入力に依る証拠（題が空いていること）は validate が決定して解決の成果物 `FreeTitle`（Prop フィールドだけの structure）として返し、act がそれを `add` に渡す。

```lean
structure State (NoteId UserId G : Type) where   -- Effect Set = この UseCase が観測する世界の最小射影
  notes : NoteRepositoryState NoteId UserId
  noteIds : G

/-- 解決の成果物: 題が空いている証拠（値は運ばない）。 -/
structure FreeTitle (c : Command) (before : State NoteId UserId G) : Type where
  free : c.title ∉ before.notes.titles

def validate (_actor : ActorContext UserId) (c : Command) (before : State …) : Except DomainError (FreeTitle c before) :=
  if !c.title.valid then .error .emptyTitle                              -- 始まる前の拒否だけ
  else if h : c.title ∈ before.notes.titles then .error .titleTaken else .ok ⟨h⟩
def act (actor) (fountain : Fountain G NoteId) (c) (before) (hfresh : fountain.Fresh before.noteIds before.notes.ids) (free : FreeTitle c before) : State … := …   -- Entity のふるまいの適用一発
def execute (actor) (fountain) (c) (before) (hfresh) := (validate actor c before).map (act actor fountain c before hfresh)
```

- validate の戻り値: 既存集約を変える UseCase = 解決の成果物（集約ルート）、新規追加 = `Unit` か証拠（Prop フィールドだけの structure。`: Type` を明記する）、参照系 = `Unit`。
- 契約定理: エラー枝 1 本 = 定理 1 本（`execute_<error>`）と成功（`execute_ok`）。作用後の状態全体がオラクルになるので、追加 / 更新の等式（`act_appends` 等）・泉の消費・フレームは置いてもその系として指名しない。
  境界の可到達性が使う `execute_ok_shape`（成功なら結果は act の形）も置く。
- 名義（`ActorContext`）・時計・泉はポート位置（先頭）。ペイロードに混ぜない。証明の引数はポートと入力の後、validate の成果物の前（execute では末尾）。

## 4b. 外部能力の Port（`Application/Port/<Port>/<操作>.lean`）

外部能力（社員ディレクトリ・決済・通知など、自システムの外にある能力）は Port として書く。Lean に書くのは要求（`Request`）・観測（`Outcome`）・自システムの語彙の純データと、要求を決める def・観測を受けて確定する def だけ。外部の呼び方（HTTP・SDK・認証・再試行）は書かない — Adapter（実装）の持ち物。Port を関数フィールドの structure にして UseCase に渡す形は取らない（外部の応答は実行ごとに違ってよく、Lean は観測を量化する）。Domain が所有する能力は `Domain/Port/` に置く。例は生成器の回帰素材（`lean2kotlin/scaffold-check/port/lean`、来訪受付）の語彙。

```lean
-- Application/Port/OrganizationDirectory/FindMember.lean（Port 名はディレクトリ、操作名はファイル）
structure Request (EmployeeId : Type) where employee : EmployeeId
structure Member where name : String; active : Bool
inductive Outcome where | found (member : Member) | missing | unavailable   -- 「いない」と「答えない」は別の観測
```

Port を使う更新系 UseCase の固定形（`Command.lean` + `UseCase.lean`。固定名 `validate` / `mkRequest` / `request` / `apply` / `execute`）:

```lean
def validate (actor) (c) (before) : Except DomainError (Vacant before) := …                       -- 始まる前の拒否だけ
def mkRequest (c) (before) (_v : Vacant before) : FindMember.Request EmployeeId := ⟨c.host⟩
def request (actor) (c) (before) := (validate actor c before).map (mkRequest c before)             -- 要求は validate が通ったときだけ
def apply (actor) (fountain) (outcome : FindMember.Outcome) (c) (before) (hfresh) (v : Vacant before) : Except DomainError (State …) :=
  match outcome with
  | .missing => .error .hostMissing | .unavailable => .error .directoryUnavailable
  | .found m => if m.active then .ok { … before.visits.add (Visit.book … m.name …) hfresh v.vacant … } else .error .hostInactive
def execute (actor) (fountain) (outcome) (c) (before) (hfresh) := (validate actor c before) >>= apply actor fountain outcome c before hfresh
```

- 観測（`Outcome`）は名義・時計・泉と同格の調達の引数種で、execute がポート位置で受ける。本番では実装が Port から調達する（署名から落ちる）。
- 1 回の execute で観測する外部操作は 1 種 1 回。複数件は `Request` / `Outcome` の `List` に束ね、観測で次の要求が変わるなら遷移を分ける（束ねられない形はモデルの再検討シグナル）。
- request と execute は同じ validate を通る。request が拒否するなら、どの観測に対しても execute は同じ拒否（validate の拒否の定理は観測を量化する）。外部の情報を読んだ結果の拒否は apply の `Except` で言い、「いない」と「答えない」を同じ拒否に丸めない。
- 契約定理: validate の拒否ごと・観測ごとの拒否・成功（`execute_ok`）。`request_ok`（validate が通れば要求がある）は置くが指名しない。`execute_ok_shape` は「成功なら結果は apply の形」。
- Port 名は `Repository` で終えない（Repository は自システムの集約の取得・保存）。外部の Aggregate を写した Repository を作らない。

## 4c. 内部入力（`Application/UseCase/<X>UseCase/Observation.lean` + `UseCase.lean`）

提供元からの通知（決済の確定など）や worker / timer からの契機は利用者の操作ではない。第 3 の固定形として `Observation.lean`（入力語彙 `Observation`。名義は入れない）+ `UseCase.lean` に書く。`Command.lean` は持たない（同居は `lean-check` と抽出が止める）。名義（`ActorContext`）は受けない — 通知に利用者はいない。受信の認証・署名検証は境界（Adapter）の責務で、型だけで検証済みとみなさない。固定名は更新系と同じ（Port を使わない適用形は `validate` / `act` / `execute`、Port を使う配送形は `validate` / `mkRequest` / `request` / `apply` / `execute`）。validate は相関する処理の存在と現在状態を確かめる。例は回帰素材の決済（来訪の精算）。

```lean
-- Application/UseCase/ConfirmPaymentUseCase/Observation.lean（提供元の確定の通知。相関は冪等キー）
structure Observation (PaymentAttemptId : Type) where attempt : PaymentAttemptId; result : PaymentResult
-- UseCase.lean（適用形）
def validate (o) (before) : Except DomainError (PaymentAttempt …) :=
  match before.attempts.find? o.attempt with
  | none   => .error .unknownAttempt                                                                 -- 無関係な通知
  | some a => if a.isSettled && !a.settledAs o.result then .error .contradictingResult else .ok a   -- 矛盾は上書きしない
def act (o) (before) (_a) : State … := ⟨before.attempts.update o.attempt (fun a => a.settle o.result) (fun _ => rfl)⟩   -- 同じ結果の重複は変化なし
def execute (o) (before) := (validate o before).map (act o before)

-- Application/UseCase/DispatchPaymentUseCase/UseCase.lean（配送形。契機は「この試みを送れ」— 送れるのは pending だけ）
def validate (o) (before) : Except DomainError (PaymentAttempt …) := …   -- 結果不明・確定済みからは送り直さない（.attemptNotDispatchable）
def mkRequest (_o) (_before) (a) : Authorize.Request PaymentAttemptId := ⟨a.id, a.amount, a.tries + 1⟩   -- 冪等キー = id、試行番号 = tries
def request (o) (before) := (validate o before).map (mkRequest o before)
def apply (outcome) (o) (before) (_a) : Except DomainError (State …) := .ok ⟨before.attempts.update o.attempt (reflect outcome) (reflect_id outcome)⟩
def execute (outcome) (o) (before) := (validate o before) >>= apply outcome o before
```

- 副作用の要求（金額・冪等キー）は業務の処理状態（集約）に保存してから送る。保存しただけでは成立にしない。送る印（試行番号）は外部を呼ぶ前に保存する — 中断しても印が残り、同じ冪等キーで再開できる。
- 冪等キー（同じ試みは同じ鍵）と試行番号（送るたびに進む）を分ける。結果不明（送ったが答えが無い）からは新しい決済を作らず、照会（別の Port 操作を使う別の UseCase）で解く。
- 通知の分類: 重複（同じ結果をもう一度）は適用済みとして通す（状態不変）、無関係（宛先が無い）と矛盾（確定した結果と違う）は拒否、遅延・順序逆転（送れる状態や結果不明のまま届く）はその通知で確定する。どれも 1 分岐 1 定理。
- Runtime: 合併型 `Runtime/Observation.lean`（`Runtime/Command.lean` には混ぜない — 利用者の操作ではない）と `Machine.applyObservation`（名義が無いので `opened` は通さない）。ワイヤ形式は Command と同じ `{"<構成子名>": <ペイロード>}` を `Json.lean` に。`lean-check` の wiring 規則が構成子ごとに検査する。

## 5. 参照系 UseCase（CQRS）

`ReadModel.lean`（観測の Set: この画面が読む Row の複合）+ `QueryService.lean`（Query 型 + 判断 + 固定名 `query : Query → ReadModel → List View` + 判断の保証）+ `UseCase.lean`（validate / execute + 入り口の保証）。

- 読み取り側は `Domain.Entity` を import しない。Entity を読める読み側は `Projection.lean`（Entity → Row と転送定理）だけ。
- 判断の保証は健全性だけでなく**完全性と並び順**を固定する（`query_ids : (query q rm).map (·.id) = (filtered rows).map (·.id)`）。
- Row は業務事実だけを運ぶ（Semantic Read Model）。View は Row を運ばず、ふるまいを持つ VO も運ばない（View 自身の語彙で写す。`title : String`）。

## 6. 境界（`Runtime/` — 非規範）

- `Ids.lean`: ID の仮置き（`structure NoteId where id : Nat`）と泉の具体化（連番）。
- `Command.lean`: 合併型 + `Actor` + **反機能の一覧**（存在しない操作とその理由）。
- `Machine.lean`: `Snapshot`（ルートごとのコレクション + 泉の残高）・`check`（泉の境界 `bounds`。集約ルートの制約は観測モデルの構造が運ぶ）・`opened`（名義が届いた帰結。既定は何もしない。`opened_check` で検査の保存を示す）・`applyCommand` / `apply`（`check` の証明を受け取り、各腕は UseCase の execute への 1 行。泉から汲む腕には `Snapshot.fresh` を渡す）。
- `Reachable.lean`: `Snapshot.Reachable`（checked | step）と `Reachable.check`。腕ごとに `check_of_<root>_add` / `check_of_<root>_update` を用意し、`except_map_eq_ok` と `execute_ok_shape` で結果の形を取り出して適用する。
- `Views.lean`: 射影と束。`views today s viewer`。口は画面名、`Option`。
- `Json.lean`: deriving の後付け。`Snapshot` / `Actor` / `Command` は手書きで平らに固定（変更は golden が検知）。`Snapshot` の `FromJson` は観測モデルの制約を決定して弾く（構築に証明が要る）。人が打つ表記を受ける手書き `FromJson` は、直前の docstring にその表記を書く — `spec-query schemas` が入力欄の注記にする（骨格の `Title`: 文字列 `"買い物"` と `{"text": "買い物"}` の両方を受ける）。
- `Scenarios.lean`: 名前付き初期状態と `scenarioByName`、`#guard`。

## 7. 転送（`Laws/Properties.lean`）

読み取りの保証を境界の言葉に移す。観測モデルの構造が運ぶ制約（Prop フィールド）はそのまま使う。境界の検査に依る整合性の仮定は `h : s.Reachable` だけから取る（露出仮定を残さない）。check に無い事実が要るなら `check` に条項を足す（各 UseCase の保存義務になり Reachable が運ぶ）。

## 8. 契約定理の指名

- 指名する: 契約面（execute / query）越しに観測できる定理。状態の等式・decidable な検査・多重集合一致。
- 指名しない: 内部関数への言及・他の指名定理の系・証明の分解装置。迷った跡は docstring に「@[contract] は付けない — ◯◯の系」。
- Entity・VO のふるまいの定理群も漏れなく指名（効果・非効果・冪等・同一性）。
- `@[faultContract]` は def に付ける: 技術的障害で中断されたとき観測されるべき状態の定義（証明対象ではない）。Port を使う UseCase では def が観測（`Outcome`）を引数に取るかどうかが消費位置の宣言 — 取らなければ「外部を呼ぶ前の中断」（Port は呼ばれない）、取れば「応答を得た後の中断」（Port は 1 回呼ばれる）。1 つの UseCase に中断点ごとの def を置く（例: 配送の `markedNotSent`（印を保存した後・送る前）/ `sentNoAnswer`（外部は成立したかもしれないが応答を失った）/ `appliedNotCommitted`（応答を得た後・反映の commit 前）。後の 2 つは観測される状態が同じでも別の中断点として名前を持つ）。生成テストは def ごとにフック `faulted<定義名>` を要求し、モックの消費位置 → 例外 → Repository の観測の順に検査する。
- 指名して検査に至らない契約は生成の失敗になる（観測モデルのふるまい・入力語彙のふるまい・`act` の状態の等式・Port の `request` の定理は Kotlin に面が無い — 指名しない）。

## 9. 生成器との折衝

- 生成器はモデルを外から読む（規約 + アノテーション + golden）。モデルに生成配線を書かない。
- 表現で消せる不変条件は表現で消す（ネスト・属性化）。集約横断の不変条件は表現の再検討シグナル。
- 生成器が読める制約の形は 4 つ: 一意性の `(coll.map (·.f)).Nodup` と `(coll.filterMap (·.f)).Nodup`、全件の `∀ x ∈ coll, p x`、上限の `(coll.filter p).length ≤ n`（coll は同じ構造体の List のフィールド、f はその要素のフィールド、n は数字のリテラル）。述語 p は要素の 1 フィールドと閉じた値の比較だけ — `x.f = c` / `x.f ≠ c` / `x.f == c` / `x.f != c` / `decide (x.f = c)` と Bool フィールドの `x.f` / `!x.f`（c は数字・文字列・Bool・引数なしの構成子）。読めた制約どおりに Repository 契約テストの個体の列を引き、読めない形の Prop フィールドは抽出の note になる（fixture はそれを満たすとは限らない）。Prop フィールドと def の Prop 引数（泉の新鮮性など）は形状・署名から落ち、証拠だけの structure は data object に写る — 証明は実装の義務。
- 採番はドメイン状態に染み出させない（泉の抽象）。具体表現は NFR を根拠にインフラ設計が決める。
- 型引数の binder 名は `<Root>.Runtime.<binder>` で解決される（生成器の規約）。解決できないものは生成側の binder 上書きで指定する。
  型引数で抽象のままにするのは同一性の VO（各 ID）だけで、それ以外の値オブジェクトは具体名で使う（`Command (JoinCode : Type)` は規約の外 — `Command` に `JoinCode` を直に書く）。`Runtime` に表現の無い binder を残すと生成側に `binderOverrides` が要る。
- validate 面の定理に `@[contract]` を付けない。フィールド 0 の `@[actorContext]` を作らない。
- **契約面に置ける型の語彙**: `Nat` `String` `Bool` `Unit` `List` `Option` `Prod` `Except` `Std.Time.PlainDate` と `<Root>` 配下の structure / inductive だけ。`Int` `Float` `Array` `HashMap` `Fin` `Subtype`・依存型・関数フィールドは契約面（Command / State / View / DomainError / Row）に置かない。例外は Prop（構造体の Prop フィールド、def の Prop 引数、証拠の structure の値引数）で、生成器が落とす。
- **生成器が要求する固定名**: 失敗の語彙は `<Root>.DomainError`、観測モデルは `<Root>RepositoryState`（↔ `<Root>Repository`）、泉の状態は `<X>IdGeneratorState`（↔ `<X>IdGenerator`）、Entity の同一性フィールドは `id`。
- **Kotlin の名前は Lean の名前から機械的に決まる**（宣言名の末尾要素。`UseCase/<X>UseCase/` の型は `<X>` を前置）。衝突・不正な識別子は Lean 側の改名で解く（生成側の上書きに逃げない）。
- **`<X>UseCase/UseCase.lean` の structure 名は生成区分になる**: `State` = 観測モデル（fixture）、`Result` = 写像対象外、それ以外 = View の DTO。関数フィールドを持つ structure（泉の抽象など）は本番署名から落ちる。
- **Port の生成区分は置き場と固定名で決まる**: `Application/Port/<Port>/<操作>` の `Request` / `Outcome`、同じモジュールのそれ以外の純データは Port の DTO。Kotlin 名は `<Port><操作>Request` / `<Port><操作>Outcome` / `<Port><操作><名前>`、interface は `<Port>`（`application.port.<port>`。Adapter は手書き）。`execute` の観測引数は本番署名から落ち、契約テストは生成モック（`<Port>Mock`）に Lean が評価した要求と定理の観測を積んで注入する。要求・観測は値で比較できる閉じたデータ型にする（Entity・ふるまい持ちの VO を運ばない）。
- **宣言したのに検査に至らない契約は生成の失敗**（主対象に触れない定理・ケースを演繹できない定理・生成テストが 0 件の契約・写像できない固定形の署名）。note は生成が続いた情報で、失敗とは別。
- **同一性のワイヤ**: `Std.Time` の日付は ISO-8601 文字列、ID は数値なら `Long`、canonical UUID 文字列なら value class に写る。表現の決定はインフラ設計（INFRA-D）。
