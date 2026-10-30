/-
  本を貸す — 既存の集約を変える更新系（Port は使わない）。validate は宛先を解決して作用対象を返し、
  貸せるか（傷んでいない・貸出中でない）は本自身のふるまいが決める。貸した日は時計の今日。
-/
import Mini.Application.ActorContext
import Mini.Application.Clock
import Mini.Application.RepositoryState
import Mini.Domain.Error
import Mini.Application.UseCase.LendBookUseCase.Command

set_option linter.unusedSectionVars false

namespace Mini.Application.LendBookUseCase

open Mini Mini.Domain Mini.Application

variable {BookId UserId : Type} [DecidableEq BookId]

/-- 始まる前の拒否: 宛先の本が無い。成功なら作用対象を返す。 -/
def validate (_actor : ActorContext UserId) (c : Command BookId) (before : BookRepositoryState BookId) :
    Except DomainError (Book BookId) :=
  match before.find? c.book with
  | none   => .error .unknownBook
  | some b => .ok b

/-- 貸した後の観測モデル: 宛先の本に今日の貸出を適用する（貸しても同一性は変わらないので点更新できる）。 -/
def lent (clock : Clock) (c : Command BookId) (before : BookRepositoryState BookId) : BookRepositoryState BookId :=
  before.update c.book (fun b => (b.lend clock.today).toOption.getD b) (Book.lend_getD_id clock.today)

/-- 解釈: 本のふるまいの適用一発。本が断ればその拒否、受け入れれば点更新する。 -/
def act (clock : Clock) (c : Command BookId) (before : BookRepositoryState BookId) (b : Book BookId) :
    Except DomainError (BookRepositoryState BookId) :=
  (b.lend clock.today).map fun _ => lent clock c before

def execute (actor : ActorContext UserId) (clock : Clock) (c : Command BookId)
    (before : BookRepositoryState BookId) : Except DomainError (BookRepositoryState BookId) :=
  validate actor c before >>= act clock c before

/-- 貸出の保存で技術的障害が起きたら、貸出は残らない（観測される状態は作用前のまま）。 -/
@[faultContract] def savingFailed (_actor : ActorContext UserId) (_clock : Clock) (_c : Command BookId)
    (before : BookRepositoryState BookId) : BookRepositoryState BookId :=
  before

/-! ### 契約定理（エラー枝 1 本 = 定理 1 本） -/

@[contract] theorem execute_unknown (actor : ActorContext UserId) (clock : Clock) (c : Command BookId)
    (before : BookRepositoryState BookId) (h : before.find? c.book = none) :
    execute actor clock c before = .error .unknownBook := by
  simp [execute, validate, h, bind, Except.bind]

@[contract] theorem execute_damaged (actor : ActorContext UserId) (clock : Clock) (c : Command BookId)
    (before : BookRepositoryState BookId) (b : Book BookId) (h : before.find? c.book = some b)
    (hc : b.condition.lendable = false) :
    execute actor clock c before = .error .damaged := by
  simp [execute, validate, act, h, hc, Book.lend, bind, Except.bind, Except.map]

@[contract] theorem execute_already_lent (actor : ActorContext UserId) (clock : Clock) (c : Command BookId)
    (before : BookRepositoryState BookId) (b : Book BookId) (h : before.find? c.book = some b)
    (hc : b.condition.lendable = true) (hl : b.lentOn.isSome = true) :
    execute actor clock c before = .error .alreadyLent := by
  simp [execute, validate, act, h, hc, hl, Book.lend, bind, Except.bind, Except.map]

@[contract] theorem execute_ok (actor : ActorContext UserId) (clock : Clock) (c : Command BookId)
    (before : BookRepositoryState BookId) (b : Book BookId) (h : before.find? c.book = some b)
    (hc : b.condition.lendable = true) (hl : b.lentOn.isSome = false) :
    execute actor clock c before = .ok (lent clock c before) := by
  simp [execute, validate, act, h, hl, hc, Book.lend, bind, Except.bind, Except.map]

/-- 宛先の本があれば、validate はそれを作用対象として返す（状態は変わらない）。
    lean-spec は validate 面の定理を指名しないが、この素材は遷移形の生成テストが validate と execute の
    引数を併せて配線する形を通すために指名する。 -/
@[contract] theorem validate_ok (actor : ActorContext UserId) (c : Command BookId)
    (before : BookRepositoryState BookId) (b : Book BookId) (h : before.find? c.book = some b) :
    validate actor c before = .ok b := by
  simp [validate, h]

end Mini.Application.LendBookUseCase
