/-
  境界（非規範）: 直列化できる状態 Snapshot・検査 check・external のルーティング表。
  大域の遷移・大域の不変条件は書かない — 各腕は UseCase の request / execute / 障害契約への固定の配線（applyCommand / applyObservation）。
  時計（today）と名義（actor）は境界の持ち物で、状態には含めない。
-/
import Lobby.Runtime.Command
import Lobby.Runtime.Observation
import Lobby.Runtime.Environment
import Lobby.Application.UseCase.BookVisitUseCase.UseCase
import Lobby.Application.UseCase.LeaveUseCase.UseCase
import Lobby.Application.UseCase.StartPaymentUseCase.UseCase
import Lobby.Application.UseCase.DispatchPaymentUseCase.UseCase
import Lobby.Application.UseCase.ConfirmPaymentUseCase.UseCase
import Lobby.Application.UseCase.InquirePaymentUseCase.UseCase

namespace Lobby.Runtime

open Lobby Lobby.Domain Lobby.Application

/-- 境界の時計の型（時計を受ける UseCase は無いが、プロトコルは today を持つ）。 -/
abbrev Date := Std.Time.PlainDate

/-- 直列化できる世界の状態: 集約ルートごとのコレクション + 泉の残高。 -/
structure Snapshot where
  visits     : VisitRepositoryState VisitId EmployeeId
  visitIds   : VisitIdGeneratorState
  attempts   : PaymentAttemptRepositoryState PaymentAttemptId VisitId
  attemptIds : PaymentAttemptIdGeneratorState
deriving Repr, DecidableEq

def Snapshot.empty : Snapshot := ⟨⟨[], by decide, by decide⟩, ⟨0⟩, ⟨[], by decide⟩, ⟨0⟩⟩
instance : Inhabited Snapshot := ⟨Snapshot.empty⟩

/-- 泉の境界検査: 既に使われている同一性は残高より小さい（= 次に汲む値は新鮮）。2 つの泉とも。 -/
def Snapshot.check (s : Snapshot) : Bool :=
  s.visits.visits.all (fun v => decide (v.id.id < s.visitIds.next)) &&
    s.attempts.attempts.all (fun a => decide (a.id.id < s.attemptIds.next))

theorem Snapshot.freshVisit (s : Snapshot) (h : s.check = true) :
    visitFountain.Fresh s.visitIds s.visits.ids := by
  intro hmem
  simp only [Snapshot.check, Bool.and_eq_true] at h
  simp only [VisitRepositoryState.ids, List.mem_map] at hmem
  obtain ⟨v, hv, hid⟩ := hmem
  have := (List.all_eq_true.mp h.1) v hv
  simp only [decide_eq_true_eq] at this
  rw [hid] at this
  exact absurd this (Nat.lt_irrefl _)

theorem Snapshot.freshAttempt (s : Snapshot) (h : s.check = true) :
    paymentAttemptFountain.Fresh s.attemptIds s.attempts.ids := by
  intro hmem
  simp only [Snapshot.check, Bool.and_eq_true] at h
  simp only [PaymentAttemptRepositoryState.ids, List.mem_map] at hmem
  obtain ⟨a, ha, hid⟩ := hmem
  have := (List.all_eq_true.mp h.2) a ha
  simp only [decide_eq_true_eq] at this
  rw [hid] at this
  exact absurd this (Nat.lt_irrefl _)

/-- 名義が届いた帰結（コマンドではない）。既定では何もしない。 -/
def Snapshot.opened (_actor : Actor) (s : Snapshot) : Snapshot := s

theorem Snapshot.opened_check (actor : Actor) (s : Snapshot) (h : s.check = true) :
    (s.opened actor).check = true := h

/-! ### external — 外部能力と内部入力を扱う経路（環境つき） -/

/-- external の入力: 利用者の操作（名義つき）か内部入力。fault はモデルにある障害契約（def 名）の指名で、
    任意の事後状態を外から渡す口ではない。 -/
inductive Input where
  | command (actor : Actor) (c : Command) (fault : Option String)
  | observation (o : Observation) (fault : Option String)
deriving Repr

/-- external の 1 手の結果。refused は状態不変。fault は指名した障害契約が言う状態と、そこまでに消費した外部呼び出しの数。
    harness は script の不一致・不足などハーネスの失敗で、業務の拒否にも外部の観測にも化けない。 -/
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

/-- 来訪の状態の埋め込みと取り出し。 -/
def Snapshot.visitState (s : Snapshot) : BookVisitUseCase.State VisitId EmployeeId VisitIdGeneratorState :=
  ⟨s.visits, s.visitIds⟩
def Snapshot.putVisitState (s : Snapshot) (st : BookVisitUseCase.State VisitId EmployeeId VisitIdGeneratorState) : Snapshot :=
  { s with visits := st.visits, visitIds := st.visitIds }

/-- 決済の開始の状態の埋め込みと取り出し。 -/
def Snapshot.startState (s : Snapshot) : StartPaymentUseCase.State PaymentAttemptId VisitId EmployeeId PaymentAttemptIdGeneratorState :=
  ⟨s.visits, s.attempts, s.attemptIds⟩
def Snapshot.putStartState (s : Snapshot)
    (st : StartPaymentUseCase.State PaymentAttemptId VisitId EmployeeId PaymentAttemptIdGeneratorState) : Snapshot :=
  { s with visits := st.visits, attempts := st.attempts, attemptIds := st.attemptIds }

/-- 決済の試みの列だけを運ぶ State（配送・確定・照会）。 -/
def Snapshot.putAttempts (s : Snapshot) (attempts : PaymentAttemptRepositoryState PaymentAttemptId VisitId) : Snapshot :=
  { s with attempts }

/-- 利用者の操作のルーティング表。Port を使う腕は `viaPort`、使わない腕は `direct`。
    障害契約の指名は腕ごとの表で解き、値は `@[faultContract]` の def の部分適用。 -/
def Snapshot.applyCommand (_today : Date) (actor : Actor) (cmd : Command) (fault : Option String) (s : Snapshot)
    (env : Environment) (h : s.check = true) : StepResult :=
  match cmd with
  | .bookVisit c =>
    let before := s.visitState
    let hfresh := Snapshot.freshVisit s h
    withFault fault
      [("savingFailed", FaultSpec.afterResponse fun (o : Port.OrganizationDirectory.FindMember.Outcome) =>
          s.putVisitState (BookVisitUseCase.savingFailed actor.context visitFountain o c before hfresh))] fun f =>
      viaPort env (BookVisitUseCase.request actor.context c before)
        (fun i => match i with | .organizationDirectoryFindMember r o => some (r, o) | _ => none)
        (fun o => (BookVisitUseCase.execute actor.context visitFountain o c before hfresh).map s.putVisitState)
        (f.map fun (n, spec) => (s!"BookVisitUseCase.{n}", spec))
  | .leave c =>
    withFault fault [] fun f =>
      direct env ((LeaveUseCase.execute actor.context c s.visits).map fun v => { s with visits := v })
        (f.map fun (n, after) => (s!"LeaveUseCase.{n}", after))
  | .startPayment c =>
    let before := s.startState
    let hfresh := Snapshot.freshAttempt s h
    withFault fault
      [("beforeCommit", s.putStartState (StartPaymentUseCase.beforeCommit actor.context paymentAttemptFountain c before hfresh))] fun f =>
      direct env ((StartPaymentUseCase.execute actor.context paymentAttemptFountain c before hfresh).map s.putStartState)
        (f.map fun (n, after) => (s!"StartPaymentUseCase.{n}", after))

/-- 内部入力のルーティング表: 名義が無いので `opened` は通さない。 -/
def Snapshot.applyObservation (_today : Date) (obs : Observation) (fault : Option String) (s : Snapshot)
    (env : Environment) (_h : s.check = true) : StepResult :=
  match obs with
  | .dispatchPayment o =>
    let before : DispatchPaymentUseCase.State PaymentAttemptId VisitId := ⟨s.attempts⟩
    withFault fault
      [("markedNotSent", FaultSpec.beforeCall (s.putAttempts (DispatchPaymentUseCase.markedNotSent o before).attempts)),
       ("sentNoAnswer", FaultSpec.afterResponse fun (out : Port.PaymentGateway.Authorize.Outcome) =>
          s.putAttempts (DispatchPaymentUseCase.sentNoAnswer out o before).attempts),
       ("appliedNotCommitted", FaultSpec.afterResponse fun (out : Port.PaymentGateway.Authorize.Outcome) =>
          s.putAttempts (DispatchPaymentUseCase.appliedNotCommitted out o before).attempts)] fun f =>
      viaPort env (DispatchPaymentUseCase.request o before)
        (fun i => match i with | .paymentGatewayAuthorize r out => some (r, out) | _ => none)
        (fun out => (DispatchPaymentUseCase.execute out o before).map fun st => s.putAttempts st.attempts)
        (f.map fun (n, spec) => (s!"DispatchPaymentUseCase.{n}", spec))
  | .confirmPayment o =>
    let before : ConfirmPaymentUseCase.State PaymentAttemptId VisitId := ⟨s.attempts⟩
    withFault fault [] fun f =>
      direct env ((ConfirmPaymentUseCase.execute o before).map fun st => s.putAttempts st.attempts)
        (f.map fun (n, after) => (s!"ConfirmPaymentUseCase.{n}", after))
  | .inquirePayment o =>
    let before : InquirePaymentUseCase.State PaymentAttemptId VisitId := ⟨s.attempts⟩
    withFault fault [] fun f =>
      viaPort env (InquirePaymentUseCase.request o before)
        (fun i => match i with | .paymentGatewayInquire r out => some (r, out) | _ => none)
        (fun out => (InquirePaymentUseCase.execute out o before).map fun st => s.putAttempts st.attempts)
        (f.map fun (n, spec) => (s!"InquirePaymentUseCase.{n}", spec))

/-- external のルーティング: 利用者の操作は `applyCommand`、内部入力は `applyObservation`。 -/
def Snapshot.applyExternal (today : Date) (input : Input) (s : Snapshot) (env : Environment)
    (h : s.check = true) : StepResult :=
  match input with
  | .command actor cmd fault => s.applyCommand today actor cmd fault env h
  | .observation obs fault => s.applyObservation today obs fault env h

end Lobby.Runtime
