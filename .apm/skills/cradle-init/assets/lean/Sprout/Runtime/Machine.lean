/-
  境界（非規範）: 直列化できる状態 Snapshot・検査 check・ルーティング表 apply（旧経路）と applyExternal（外部能力と内部入力の経路）。
  大域の遷移・大域の不変条件は書かない — 各腕は UseCase の execute / request / 障害契約への固定の配線。
  時計（today）と名義（actor）は境界の持ち物で、状態には含めない。
-/
import Sprout.Runtime.Command
import Sprout.Runtime.Observation
import Sprout.Runtime.Environment
import Sprout.Application.UseCase.PostNoteUseCase.UseCase
import Sprout.Application.UseCase.CloseNoteUseCase.UseCase

namespace Sprout.Runtime

open Sprout Sprout.Domain Sprout.Application

/-- 直列化できる世界の状態: 集約ルートごとのコレクション + 泉の残高だけ。 -/
structure Snapshot where
  notes   : Notes
  noteIds : NoteIdGeneratorState
deriving Repr, DecidableEq

def Snapshot.empty : Snapshot := ⟨⟨[], by decide, by decide⟩, ⟨0⟩⟩
instance : Inhabited Snapshot := ⟨Snapshot.empty⟩

/-- 泉の境界検査: 既に使われている同一性は残高より小さい（= 次に汲む値は新鮮）。 -/
def Snapshot.bounds (s : Snapshot) : Bool :=
  s.notes.notes.all (fun n => decide (n.id.id < s.noteIds.next))

/-- 外から受け取った状態の検査。集約ルートの制約（同一性の一意性）は観測モデルの構造が運ぶので、
    検査するのは泉の境界だけ。 -/
def Snapshot.check (s : Snapshot) : Bool := s.bounds

/-- 検査を通った状態では、泉から次に汲む値は新鮮（UseCase が要求する泉の契約）。 -/
theorem Snapshot.fresh (s : Snapshot) (h : s.check = true) :
    noteFountain.Fresh s.noteIds s.notes.ids := by
  intro hmem
  simp only [NoteRepositoryState.ids, List.mem_map] at hmem
  obtain ⟨n, hn, hid⟩ := hmem
  have := (List.all_eq_true.mp h) n hn
  simp only [decide_eq_true_eq] at this
  have : n.id.id < s.noteIds.next := this
  rw [hid] at this
  exact absurd this (Nat.lt_irrefl _)

/-- 名義が届いた帰結（コマンドではない）。既定では何もしない —
    「開くたびに写す」類の帰結があるドメインはここに書く。 -/
def Snapshot.opened (_actor : Actor) (s : Snapshot) : Snapshot := s

/-- 帰結は検査を保つ（帰結を書くドメインはここで証明する）。 -/
theorem Snapshot.opened_check (actor : Actor) (s : Snapshot) (h : s.check = true) :
    (s.opened actor).check = true := h

/-- ルーティング: コマンドごとの殻へ、名義を実行文脈として渡す。検査を通った状態だけを受ける —
    泉から汲む UseCase にはそこから作った新鮮性の証明を渡す。
    コマンドを増やす手順: UseCase ディレクトリを作る → Command.lean に構成子を足す
    （match 非網羅でビルドが落ちて気づく）→ ここに腕を足す。 -/
def Snapshot.applyCommand (_today : Date) (actor : Actor) (cmd : Command) (s : Snapshot)
    (h : s.check = true) : Except DomainError Snapshot :=
  match cmd with
  | .postNote c =>
    (PostNoteUseCase.execute actor.context noteFountain c ⟨s.notes, s.noteIds⟩ (Snapshot.fresh s h)).map
      (fun st => ⟨st.notes, st.noteIds⟩)
  | .closeNote c =>
    (CloseNoteUseCase.execute actor.context c s.notes).map (fun st => ⟨st, s.noteIds⟩)

/-- 開く → コマンドを配る。 -/
def Snapshot.apply (today : Date) (actor : Actor) (cmd : Command) (s : Snapshot)
    (h : s.check = true) : Except DomainError Snapshot :=
  Snapshot.applyCommand today actor cmd (s.opened actor) (Snapshot.opened_check actor s h)

/-! ### external — 外部能力と内部入力を扱う経路（環境つき）。既存の `apply` はそのまま -/

/-- external の入力: 利用者の操作（名義つき）か内部入力。fault はモデルにある障害契約（def 名）の指名で、
    任意の事後状態を外から渡す口ではない。 -/
inductive Input where
  | command (actor : Actor) (c : Command) (fault : Option String)
  | observation (o : Observation) (fault : Option String)
deriving Repr

/-- external の 1 手の結果。refused は状態不変（`domainError` の意味は旧経路と同じ）。
    fault は指名した障害契約が言う状態と、そこまでに消費した外部呼び出しの数。harness は script の不一致・不足など
    ハーネスの失敗で、業務の拒否にも外部の観測にも化けない。 -/
inductive StepResult where
  | applied (s : Snapshot) (env : Environment) (used : List Interaction)
  | refused (e : DomainError) (env : Environment) (used : List Interaction)
  | fault (s : Snapshot) (env : Environment) (used : List Interaction) (contract : String) (portCalls : Nat)
  | harness (message : String)
deriving Repr

/-- 障害契約の指名の解決先（腕ごとの表の値）。消費位置は構成子が決める: 外部を呼ぶ前の中断は script を消費せず（portCalls 0）、
    応答を得た後の中断は観測を受け取って消費する（portCalls 1）。値は `@[faultContract]` の def そのものの部分適用で、
    腕で作り直さない。 -/
inductive FaultSpec (O : Type) where
  | beforeCall (after : Snapshot)
  | afterResponse (after : O → Snapshot)

/-- Port を使わない腕の配線: execute の結果をそのまま。障害の指名は成功経路でだけ意味を持つ（外部は呼ばない）—
    model が拒否する入力への指名はハーネスの失敗（障害契約は execute が受け入れる入力にだけ宣言される）。 -/
def direct (env : Environment) (run : Except DomainError Snapshot) (fault : Option (String × Snapshot)) : StepResult :=
  match run with
  | .error e =>
    match fault with
    | some (name, _) => .harness s!"fault {name} nominated on an input the model refuses ({repr e}); fault contracts are declared for inputs execute accepts"
    | none => .refused e env []
  | .ok s' =>
    match fault with
    | some (name, after) => .fault after env [] name 0
    | none => .applied s' env []

/-- Port を使う腕の固定配線: 要求を評価 → 通ったときだけ script の次と照合して観測を調達 → execute。
    要求が拒否されれば外部を呼ばず cursor は不変。観測後の拒否は cursor 消費済み。
    障害の指名: 外部を呼ぶ前の中断は script を消費せず、応答を得た後の中断は消費してから障害契約の状態を返す。
    要求の不一致・script の不足・別の Port 操作、そして拒否される入力への指名はハーネスの失敗。 -/
def viaPort {R O : Type} [BEq R] (env : Environment) (req : Except DomainError R)
    (pick : Interaction → Option (R × O)) (run : O → Except DomainError Snapshot)
    (fault : Option (String × FaultSpec O)) : StepResult :=
  match req with
  | .error e =>
    match fault with
    | some (name, _) => .harness s!"fault {name} nominated on an input the model refuses ({repr e}); fault contracts are declared for inputs execute accepts"
    | none => .refused e env []
  | .ok r =>
    match fault with
    | some (name, .beforeCall after) => .fault after env [] name 0
    | _ =>
      match env.next with
      | none => .harness "script exhausted: the model issued a request but the environment has no more interactions"
      | some i =>
        match pick i with
        | none => .harness "wrong port or operation: the next interaction is for another port operation"
        | some (expected, outcome) =>
          if expected == r then
            match run outcome, fault with
            | .ok s', none => .applied s' env.consume [i]
            | .ok _, some (name, .afterResponse after) => .fault (after outcome) env.consume [i] name 1
            | .ok s', some (_, .beforeCall _) => .applied s' env.consume [i]
            | .error e, none => .refused e env.consume [i]
            | .error e, some (name, _) => .harness s!"fault {name} nominated on an input the model refuses after the observation ({repr e}); fault contracts are declared for inputs execute accepts"
          else .harness "request mismatch: the model's request differs from the expected request in the environment"

/-- 障害契約の指名を腕ごとの表で解く（無い名前はハーネスの失敗）。 -/
def withFault {α : Type} (fault : Option String) (table : List (String × α))
    (k : Option (String × α) → StepResult) : StepResult :=
  match fault with
  | none => k none
  | some n =>
    match table.find? (·.1 == n) with
    | some entry => k (some entry)
    | none => .harness s!"unknown fault contract: {n}"

/-- 内部入力のルーティング: 名義が無いので `opened` は通さない。内部入力を持つ UseCase を足す手順は
    コマンドと同じ（Observation.lean → `Runtime/Observation.lean` に構成子 → ここに腕 → `Json.lean` にワイヤ）。 -/
def Snapshot.applyObservation (_today : Date) (obs : Observation) (_s : Snapshot) (_env : Environment)
    (_h : _s.check = true) : StepResult :=
  nomatch obs

/-- external のルーティング: 利用者の操作は開く → 腕へ、内部入力は腕へ。Port を使う腕は `viaPort`、
    使わない腕は `direct`。障害契約の指名は腕ごとの表で解く（この骨格の表は空 — 指名はハーネスの失敗）。 -/
def Snapshot.applyExternal (today : Date) (input : Input) (s : Snapshot) (env : Environment)
    (h : s.check = true) : StepResult :=
  match input with
  | .command actor cmd fault =>
    withFault fault [] fun f => direct env (Snapshot.apply today actor cmd s h) f
  | .observation obs _ => Snapshot.applyObservation today obs s env h

end Sprout.Runtime
