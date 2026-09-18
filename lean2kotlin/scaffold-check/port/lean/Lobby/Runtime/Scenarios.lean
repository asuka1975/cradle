/-
  名前付きの初期状態と環境、流れを一巡させる #guard 表明（golden の源）。期待値のずれは lake build の失敗として検知される。
-/
import Lobby.Runtime.Views
import Lobby.Runtime.Reachable
import Lobby.Runtime.Json

namespace Lobby.Runtime

open Lobby Lobby.Domain Lobby.Application Lobby.Application.Port
open Lean (toJson fromJson?)

/-- 受付に立つ担当者。 -/
def reception : UserId := ⟨1⟩
/-- 受入担当者の社員番号。 -/
def taro : EmployeeId := ⟨10⟩

/-- シナリオの基準日（非規範 — 時計は境界の持ち物）。 -/
def Scenario.today : Date := date("2026-01-01")

/-- 基本シナリオ: 退出済みの来訪 1 件（精算できる）、受付中は無し、決済の試みは無し。 -/
def Scenario.basic : Snapshot :=
  { visits := ⟨[ (Visit.book ⟨0⟩ taro "受入 太郎" ⟨"来訪 花子"⟩).leave ], by decide, by decide⟩
    visitIds := ⟨1⟩
    attempts := ⟨[], by decide⟩
    attemptIds := ⟨0⟩ }

def scenarioByName : String → Option Snapshot
  | "basic" => some Scenario.basic
  | _       => none

/-- 社員ディレクトリが太郎を在籍として答える。 -/
def Environment.directoryFound : Environment :=
  ⟨[.organizationDirectoryFindMember ⟨taro⟩ (.found ⟨"受入 太郎", true⟩)], 0⟩

/-- 決済ゲートウェイが最初の試み（鍵 0、金額 1、1 度目）を承認する。 -/
def Environment.paymentAuthorized : Environment :=
  ⟨[.paymentGatewayAuthorize ⟨⟨0⟩, 1, 1⟩ .authorized], 0⟩

/-- 答えを失い、照会では届いていないと分かり、送り直しで承認される。 -/
def Environment.paymentLost : Environment :=
  ⟨[.paymentGatewayAuthorize ⟨⟨0⟩, 1, 1⟩ .unknown,
    .paymentGatewayInquire ⟨⟨0⟩⟩ .notFound,
    .paymentGatewayAuthorize ⟨⟨0⟩, 1, 2⟩ .authorized], 0⟩

/-- 送る前に中断した試みの再開: 照会では届いておらず、送り直しで承認される。 -/
def Environment.paymentInterrupted : Environment :=
  ⟨[.paymentGatewayInquire ⟨⟨0⟩⟩ .notFound,
    .paymentGatewayAuthorize ⟨⟨0⟩, 1, 2⟩ .authorized], 0⟩

/-- 応答を失った試みの再開: 送った要求は外部で成立しており、照会で確定が分かる。 -/
def Environment.paymentAnswerLost : Environment :=
  ⟨[.paymentGatewayAuthorize ⟨⟨0⟩, 1, 1⟩ .authorized,
    .paymentGatewayInquire ⟨⟨0⟩⟩ (.settled .authorized)], 0⟩

def environmentByName : String → Option Environment
  | "directoryFound"      => some Environment.directoryFound
  | "paymentAuthorized"   => some Environment.paymentAuthorized
  | "paymentLost"         => some Environment.paymentLost
  | "paymentInterrupted"  => some Environment.paymentInterrupted
  | "paymentAnswerLost"   => some Environment.paymentAnswerLost
  | _                     => none

/-- 入力列を順に流す（`flow` の写し。ハーネスの失敗があれば無し）。 -/
def runInputs (today : Date) (s : Snapshot) (env : Environment) (inputs : List Input) : Option (Snapshot × Environment) :=
  if h : s.check = true then
    let (t, s', env') := flow today inputs s env h
    if t.any (fun x => match x.2.2 with | .harness _ => true | _ => false) then none else some (s', env')
  else none

def actor : Actor := ⟨⟨reception⟩⟩

-- 初期状態は検査を通る
#guard Scenario.basic.check

-- 受付: ディレクトリで確認して受け付ける（環境を 1 つ消費）
#guard match Snapshot.applyExternal Scenario.today (.command actor (.bookVisit ⟨taro, ⟨"来訪 次郎"⟩⟩) none) Scenario.basic Environment.directoryFound (by decide) with
  | .applied s env [_] => env.exhausted && (views Scenario.today s (some reception)).visits.map (·.length) == some 2
  | _ => false

-- 名前が空なら外部を呼ばない（環境は不変）
#guard match Snapshot.applyExternal Scenario.today (.command actor (.bookVisit ⟨taro, ⟨""⟩⟩) none) Scenario.basic Environment.directoryFound (by decide) with
  | .refused .emptyVisitor env [] => env == Environment.directoryFound
  | _ => false

-- 要求が script と違えばハーネスの失敗（業務の拒否にならない）
#guard match Snapshot.applyExternal Scenario.today (.command actor (.bookVisit ⟨⟨99⟩, ⟨"来訪 次郎"⟩⟩) none) Scenario.basic Environment.directoryFound (by decide) with
  | .harness _ => true
  | _ => false

-- 精算を始め、配送で承認され、通知の重複は適用済みとして通る（環境は全消費）
#guard match runInputs Scenario.today Scenario.basic Environment.paymentAuthorized
    [.command actor (.startPayment ⟨⟨0⟩⟩) none, .observation (.dispatchPayment ⟨⟨0⟩⟩) none,
     .observation (.confirmPayment ⟨⟨0⟩, .authorized⟩) none] with
  | some (s, env) => env.exhausted && (paymentViews s.attempts).map (·.phase) == [.authorized]
  | none => false

-- 答えを失った試みは送り直さず照会し、届いていなければ送れる状態に戻って同じ鍵で送り直す
#guard match runInputs Scenario.today Scenario.basic Environment.paymentLost
    [.command actor (.startPayment ⟨⟨0⟩⟩) none, .observation (.dispatchPayment ⟨⟨0⟩⟩) none,
     .observation (.inquirePayment ⟨⟨0⟩⟩) none, .observation (.dispatchPayment ⟨⟨0⟩⟩) none] with
  | some (s, env) => env.exhausted && (paymentViews s.attempts).map (fun v => (v.phase, v.tries)) == [(.authorized, 2)]
  | none => false

-- 送る前の中断（障害契約の指名）: 印は残り外部は呼ばれない。照会で届いていないと分かれば送れる状態に戻る
#guard match runInputs Scenario.today Scenario.basic Environment.paymentLost
    [.command actor (.startPayment ⟨⟨0⟩⟩) none, .observation (.dispatchPayment ⟨⟨0⟩⟩) (some "markedNotSent")] with
  | some (s, env) => env.cursor == 0 && (paymentViews s.attempts).map (fun v => (v.phase, v.tries)) == [(.sending, 1)]
  | none => false


-- script が尽きていれば外部を呼べない（ハーネスの失敗。業務の拒否にならない）
#guard match Snapshot.applyExternal Scenario.today (.command actor (.bookVisit ⟨taro, ⟨"来訪 次郎"⟩⟩) none) Scenario.basic Environment.empty (by decide) with
  | .harness _ => true
  | _ => false

-- 別の Port 操作が並んでいてもハーネスの失敗
#guard match Snapshot.applyExternal Scenario.today (.command actor (.bookVisit ⟨taro, ⟨"来訪 次郎"⟩⟩) none) Scenario.basic Environment.paymentAuthorized (by decide) with
  | .harness _ => true
  | _ => false

-- 知らない障害契約の指名はハーネスの失敗
#guard match Snapshot.applyExternal Scenario.today (.command actor (.leave ⟨⟨0⟩⟩) (some "nope")) Scenario.basic Environment.empty (by decide) with
  | .harness _ => true
  | _ => false

-- 拒否される入力への障害の指名はハーネスの失敗（障害契約は通る入力にだけ宣言される）
#guard match Snapshot.applyExternal Scenario.today (.command actor (.bookVisit ⟨taro, ⟨""⟩⟩) (some "savingFailed")) Scenario.basic Environment.directoryFound (by decide) with
  | .harness _ => true
  | _ => false

-- 観測の後の拒否は cursor を消費している
#guard match Snapshot.applyExternal Scenario.today (.command actor (.bookVisit ⟨taro, ⟨"来訪 次郎"⟩⟩) none) Scenario.basic
    ⟨[.organizationDirectoryFindMember ⟨taro⟩ (.found ⟨"受入 太郎", false⟩)], 0⟩ (by decide) with
  | .refused .hostInactive env [_] => env.cursor == 1
  | _ => false

-- 障害契約ごとの消費位置。保存の失敗（応答の後）: 状態は作用前のまま、script は 1 つ消費
#guard match Snapshot.applyExternal Scenario.today (.command actor (.bookVisit ⟨taro, ⟨"来訪 次郎"⟩⟩) (some "savingFailed")) Scenario.basic Environment.directoryFound (by decide) with
  | .fault s env [_] "BookVisitUseCase.savingFailed" 1 => s == Scenario.basic && env.cursor == 1
  | _ => false

-- 開始の commit 前の中断（外部は呼ばない）: 試みも採番も残らない
#guard match Snapshot.applyExternal Scenario.today (.command actor (.startPayment ⟨⟨0⟩⟩) (some "beforeCommit")) Scenario.basic Environment.empty (by decide) with
  | .fault s env [] "StartPaymentUseCase.beforeCommit" 0 => s == Scenario.basic && env == Environment.empty
  | _ => false

-- 応答を失った中断と反映の commit 前の中断（応答の後）: 印は残り、script は 1 つ消費
#guard match runInputs Scenario.today Scenario.basic Environment.paymentAuthorized [.command actor (.startPayment ⟨⟨0⟩⟩) none] with
  | some (s, env) =>
    if h : s.check = true then
      (match Snapshot.applyExternal Scenario.today (.observation (.dispatchPayment ⟨⟨0⟩⟩) (some "sentNoAnswer")) s env h with
        | .fault s' env' [_] "DispatchPaymentUseCase.sentNoAnswer" 1 =>
          env'.cursor == 1 && (paymentViews s'.attempts).map (fun v => (v.phase, v.tries)) == [(.sending, 1)]
        | _ => false) &&
      (match Snapshot.applyExternal Scenario.today (.observation (.dispatchPayment ⟨⟨0⟩⟩) (some "appliedNotCommitted")) s env h with
        | .fault s' env' [_] "DispatchPaymentUseCase.appliedNotCommitted" 1 =>
          env'.cursor == 1 && (paymentViews s'.attempts).map (fun v => (v.phase, v.tries)) == [(.sending, 1)]
        | _ => false)
    else false
  | none => false

-- 送る前の中断からの再開（golden payment-fault と同じ列）: 照会で届いていないと分かり、同じ鍵で送り直して承認される
#guard match runInputs Scenario.today Scenario.basic Environment.paymentInterrupted
    [.command actor (.startPayment ⟨⟨0⟩⟩) none, .observation (.dispatchPayment ⟨⟨0⟩⟩) (some "markedNotSent"),
     .observation (.dispatchPayment ⟨⟨0⟩⟩) none, .observation (.inquirePayment ⟨⟨0⟩⟩) none,
     .observation (.dispatchPayment ⟨⟨0⟩⟩) none] with
  | some (s, env) => env.exhausted && (paymentViews s.attempts).map (fun v => (v.phase, v.tries)) == [(.authorized, 2)]
  | none => false

-- 応答を失った中断からの再開（golden payment-answer-lost と同じ列）: 送った要求は成立しており、照会で確定
#guard match runInputs Scenario.today Scenario.basic Environment.paymentAnswerLost
    [.command actor (.startPayment ⟨⟨0⟩⟩) none, .observation (.dispatchPayment ⟨⟨0⟩⟩) (some "sentNoAnswer"),
     .observation (.inquirePayment ⟨⟨0⟩⟩) none] with
  | some (s, env) => env.exhausted && (paymentViews s.attempts).map (fun v => (v.phase, v.tries)) == [(.authorized, 1)]
  | none => false


-- 観測の後に execute が断る入力への障害の指名もハーネスの失敗
#guard match Snapshot.applyExternal Scenario.today (.command actor (.bookVisit ⟨taro, ⟨"来訪 次郎"⟩⟩) (some "savingFailed")) Scenario.basic
    ⟨[.organizationDirectoryFindMember ⟨taro⟩ .missing], 0⟩ (by decide) with
  | .harness _ => true
  | _ => false

-- JSON の往復: 初期状態と名前付きの環境は同じ値に戻る
#guard match (fromJson? (toJson Scenario.basic) : Except String Snapshot) with
  | .ok s => s == Scenario.basic
  | .error _ => false
#guard ["directoryFound", "paymentAuthorized", "paymentLost", "paymentInterrupted", "paymentAnswerLost"].all fun n =>
  match environmentByName n with
  | some e => (match (fromJson? (toJson e) : Except String Environment) with | .ok e' => e' == e | .error _ => false)
  | none => false

end Lobby.Runtime
