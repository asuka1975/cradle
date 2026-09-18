/-
  境界の環境（非規範）: 外部能力の script（Port・操作・期待する要求・観測の列）と cursor。
  1 リクエスト 1 プロセスなので、環境も状態と同じく応答で返し、次の step が受け取る（プロセス内に持たない）。
  Port を持たない間、Interaction の構成子は無い。Port を足す手順: `Application/Port/<Port>/<操作>.lean` →
  ここに構成子 → `Machine.lean` の腕で照合 → `Json.lean` にワイヤ。
-/
import Sprout.Runtime.Ids

namespace Sprout.Runtime

/-- 1 回のやり取り: どの Port のどの操作に、どの要求が来たら、どの観測を返すか。 -/
inductive Interaction where
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

end Sprout.Runtime
