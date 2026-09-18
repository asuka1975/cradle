/-
  外部能力の Port「社員ディレクトリ」の操作「社員を引く」。
  Lean に書くのは要求（Request）と観測（Outcome）と自システムの語彙だけ。外部の呼び方（HTTP・SDK）は書かない。
  「見つからない」と「答えない」は別の観測で、どちらも業務の拒否に丸めない。
-/
namespace Lobby.Application.Port.OrganizationDirectory.FindMember

/-- 要求: 誰を引くか。 -/
structure Request (EmployeeId : Type) where
  employee : EmployeeId
deriving Repr, DecidableEq

/-- ディレクトリが答えた社員（自システムの語彙に写したもの）。 -/
structure Member where
  name   : String
  active : Bool
deriving Repr, DecidableEq

/-- 観測: 見つかった / いない / ディレクトリが答えない。 -/
inductive Outcome where
  | found (member : Member)
  | missing
  | unavailable
deriving Repr, DecidableEq

end Lobby.Application.Port.OrganizationDirectory.FindMember
