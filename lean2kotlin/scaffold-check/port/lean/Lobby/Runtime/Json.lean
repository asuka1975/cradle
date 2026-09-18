/-
  語彙型への JSON の後付け（境界の関心）。仕様層は ToJson / FromJson を deriving しない。
  ワイヤ形式は境界の契約であり、golden と CLI がそれを守る。
-/
import Lean
import Lobby.Runtime.Views

namespace Lobby.Runtime

open Lean Lobby Lobby.Domain Lobby.Application

deriving instance ToJson, FromJson for VisitId
deriving instance ToJson, FromJson for EmployeeId
deriving instance ToJson, FromJson for UserId
deriving instance ToJson, FromJson for PaymentAttemptId
deriving instance ToJson, FromJson for Lobby.Application.VisitIdGeneratorState
deriving instance ToJson, FromJson for Lobby.Application.PaymentAttemptIdGeneratorState
deriving instance ToJson for Lobby.VisitorName

/-- 来訪者の名前の文字列をそのまま受ける（`{"text": …}` も受ける）。 -/
instance : FromJson Lobby.VisitorName where
  fromJson?
    | .str s => pure ⟨s⟩
    | j      => do
      let s ← (← j.getObjVal? "text").getStr?
      pure ⟨s⟩

deriving instance ToJson, FromJson for Lobby.VisitPhase
deriving instance ToJson, FromJson for Lobby.PaymentPhase
deriving instance ToJson, FromJson for Lobby.PaymentResult
deriving instance ToJson, FromJson for Lobby.DomainError
deriving instance ToJson, FromJson for Lobby.Domain.Visit
deriving instance ToJson, FromJson for Lobby.Domain.PaymentAttempt
deriving instance ToJson, FromJson for Lobby.Application.VisitView
deriving instance ToJson, FromJson for Lobby.Application.PaymentView
deriving instance ToJson, FromJson for Views
deriving instance ToJson, FromJson for Lobby.Application.BookVisitUseCase.Command
deriving instance ToJson, FromJson for Lobby.Application.LeaveUseCase.Command
deriving instance ToJson, FromJson for Lobby.Application.StartPaymentUseCase.Command
deriving instance ToJson, FromJson for Lobby.Application.DispatchPaymentUseCase.Observation
deriving instance ToJson, FromJson for Lobby.Application.ConfirmPaymentUseCase.Observation
deriving instance ToJson, FromJson for Lobby.Application.InquirePaymentUseCase.Observation
deriving instance ToJson, FromJson for Lobby.Application.Port.OrganizationDirectory.FindMember.Request
deriving instance ToJson, FromJson for Lobby.Application.Port.OrganizationDirectory.FindMember.Member
deriving instance ToJson, FromJson for Lobby.Application.Port.OrganizationDirectory.FindMember.Outcome
deriving instance ToJson, FromJson for Lobby.Application.Port.PaymentGateway.Authorize.Request
deriving instance ToJson, FromJson for Lobby.Application.Port.PaymentGateway.Authorize.Outcome
deriving instance ToJson, FromJson for Lobby.Application.Port.PaymentGateway.Inquire.Request
deriving instance ToJson, FromJson for Lobby.Application.Port.PaymentGateway.Inquire.Outcome

/-- ドメインの日付のワイヤ形式: ISO-8601 `"uuuu-MM-dd"`（決定的）。 -/
instance : ToJson Date where
  toJson d := Json.str d.toLeanDateString

/-- 暦として実在する日付だけが構築できる。 -/
instance : FromJson Date where
  fromJson? j := do
    let s ← j.getStr?
    match Std.Time.PlainDate.fromLeanDateString s with
    | .ok d    => pure d
    | .error e => throw s!"invalid date '{s}' (expected ISO-8601 uuuu-MM-dd): {e}"

/-! ### 状態のワイヤ形式（集約ルートごとのコレクションが平場に並ぶ + 泉の残高） -/

instance : ToJson Snapshot where
  toJson s := Json.mkObj [("visits", toJson s.visits.visits), ("visitIds", toJson s.visitIds),
    ("attempts", toJson s.attempts.attempts), ("attemptIds", toJson s.attemptIds)]

/-- 観測モデルの制約（同一性の一意性・受付中は高々 1 件）は構築時に要るので、境界で決定して弾く。 -/
instance : FromJson Snapshot where
  fromJson? j := do
    let visits ← (j.getObjVal? "visits") >>= fromJson? (α := List (Visit VisitId EmployeeId))
    let visitIds ← (j.getObjVal? "visitIds") >>= fromJson? (α := Application.VisitIdGeneratorState)
    let attempts ← (j.getObjVal? "attempts") >>= fromJson? (α := List (PaymentAttempt PaymentAttemptId VisitId))
    let attemptIds ← (j.getObjVal? "attemptIds") >>= fromJson? (α := Application.PaymentAttemptIdGeneratorState)
    if hid : (visits.map (·.id)).Nodup then
      if hone : (visits.filter (fun v => v.phase != .left)).length ≤ 1 then
        if haid : (attempts.map (·.id)).Nodup then
          pure ⟨⟨visits, hid, hone⟩, visitIds, ⟨attempts, haid⟩, attemptIds⟩
        else throw "state.attempts: duplicate id"
      else throw "state.visits: more than one visit in progress"
    else throw "state.visits: duplicate id"

/-! ### 名義のワイヤ形式: `{"user": {"id": 1}}` — コマンドとは別に運ぶ -/

instance : ToJson Actor where
  toJson a := Json.mkObj [("user", toJson a.context.user)]

instance : FromJson Actor where
  fromJson? j :=
    match (j.getObjVal? "user").toOption with
    | some uv => (fromJson? (α := UserId) uv).map (fun u => ⟨⟨u⟩⟩)
    | none    => .error "actor requires user"

/-! ### コマンドと内部入力のワイヤ形式（手書きで平らに固定）: `{"<構成子名>": <ペイロード>}` -/

private def tagged (tag : String) (payload : Json) : Json := Json.mkObj [(tag, payload)]

instance : ToJson Command where
  toJson
    | .bookVisit c    => tagged "bookVisit" (toJson c)
    | .leave c        => tagged "leave" (toJson c)
    | .startPayment c => tagged "startPayment" (toJson c)

instance : FromJson Command where
  fromJson? j :=
    match (j.getObjVal? "bookVisit").toOption, (j.getObjVal? "leave").toOption, (j.getObjVal? "startPayment").toOption with
    | some p, _, _ => (fromJson? p).map Command.bookVisit
    | _, some p, _ => (fromJson? p).map Command.leave
    | _, _, some p => (fromJson? p).map Command.startPayment
    | none, none, none => .error "unknown command (expected one of: bookVisit, leave, startPayment)"

instance : ToJson Observation where
  toJson
    | .dispatchPayment o => tagged "dispatchPayment" (toJson o)
    | .confirmPayment o  => tagged "confirmPayment" (toJson o)
    | .inquirePayment o  => tagged "inquirePayment" (toJson o)

instance : FromJson Observation where
  fromJson? j :=
    match (j.getObjVal? "dispatchPayment").toOption, (j.getObjVal? "confirmPayment").toOption, (j.getObjVal? "inquirePayment").toOption with
    | some p, _, _ => (fromJson? p).map Observation.dispatchPayment
    | _, some p, _ => (fromJson? p).map Observation.confirmPayment
    | _, _, some p => (fromJson? p).map Observation.inquirePayment
    | none, none, none => .error "unknown observation (expected one of: dispatchPayment, confirmPayment, inquirePayment)"

/-! ### 環境のワイヤ形式: `{"script": [{"port","operation","request","outcome"}…], "cursor": n}` -/

private def interaction (port op : String) (request outcome : Json) : Json :=
  Json.mkObj [("port", Json.str port), ("operation", Json.str op), ("request", request), ("outcome", outcome)]

instance : ToJson Interaction where
  toJson
    | .organizationDirectoryFindMember r o => interaction "OrganizationDirectory" "findMember" (toJson r) (toJson o)
    | .paymentGatewayAuthorize r o => interaction "PaymentGateway" "authorize" (toJson r) (toJson o)
    | .paymentGatewayInquire r o => interaction "PaymentGateway" "inquire" (toJson r) (toJson o)

instance : FromJson Interaction where
  fromJson? j := do
    let port ← (← j.getObjVal? "port").getStr?
    let op ← (← j.getObjVal? "operation").getStr?
    let r ← j.getObjVal? "request"
    let o ← j.getObjVal? "outcome"
    match port, op with
    | "OrganizationDirectory", "findMember" => pure (.organizationDirectoryFindMember (← fromJson? r) (← fromJson? o))
    | "PaymentGateway", "authorize" => pure (.paymentGatewayAuthorize (← fromJson? r) (← fromJson? o))
    | "PaymentGateway", "inquire" => pure (.paymentGatewayInquire (← fromJson? r) (← fromJson? o))
    | _, _ => throw s!"unknown port operation: {port}.{op}"

instance : ToJson Environment where
  toJson e := Json.mkObj [("script", toJson e.script), ("cursor", toJson e.cursor)]

instance : FromJson Environment where
  fromJson? j := do
    let script ← (j.getObjVal? "script") >>= fromJson? (α := List Interaction)
    let cursor ← (j.getObjVal? "cursor") >>= fromJson? (α := Nat)
    pure ⟨script, cursor⟩

end Lobby.Runtime
