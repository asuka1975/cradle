/-
  境界の環境（非規範）: 外部能力の script（Port・操作・期待する要求・観測の列）と cursor。
  1 リクエスト 1 プロセスなので、環境も状態と同じく応答で返し、次の step が受け取る。
-/
import Lobby.Runtime.Ids
import Lobby.Application.Port.OrganizationDirectory.FindMember
import Lobby.Application.Port.PaymentGateway.Authorize
import Lobby.Application.Port.PaymentGateway.Inquire

namespace Lobby.Runtime

open Lobby Lobby.Application.Port

/-- 1 回のやり取り: どの Port のどの操作に、どの要求が来たら、どの観測を返すか。 -/
inductive Interaction where
  | organizationDirectoryFindMember (request : OrganizationDirectory.FindMember.Request EmployeeId)
      (outcome : OrganizationDirectory.FindMember.Outcome)
  | paymentGatewayAuthorize (request : PaymentGateway.Authorize.Request PaymentAttemptId)
      (outcome : PaymentGateway.Authorize.Outcome)
  | paymentGatewayInquire (request : PaymentGateway.Inquire.Request PaymentAttemptId)
      (outcome : PaymentGateway.Inquire.Outcome)
deriving Repr, DecidableEq

/-- 不変の有限 script と、次に消費する位置。 -/
structure Environment where
  script : List Interaction
  cursor : Nat
deriving Repr, DecidableEq

def Environment.empty : Environment := ⟨[], 0⟩

/-- 外から受け取った環境の検査: cursor は script の範囲内。 -/
def Environment.check (e : Environment) : Bool := decide (e.cursor ≤ e.script.length)

/-- 次に消費するやり取り（script が尽きていれば無い）。 -/
def Environment.next (e : Environment) : Option Interaction := e.script[e.cursor]?

def Environment.consume (e : Environment) : Environment := { e with cursor := e.cursor + 1 }

/-- 全部消費した。 -/
def Environment.exhausted (e : Environment) : Bool := decide (e.cursor = e.script.length)

/-- やり取りを 1 つ消費しても cursor は範囲内。 -/
theorem Environment.consume_check (e : Environment) (i : Interaction) (h : e.next = some i) :
    e.consume.check = true := by
  have hlt : e.cursor < e.script.length := by
    simp only [Environment.next] at h
    exact (List.getElem?_eq_some_iff.mp h).1
  show decide (e.cursor + 1 ≤ e.script.length) = true
  exact decide_eq_true hlt

end Lobby.Runtime
