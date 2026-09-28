/-
  Cradle の骨格のサンプルドメイン（メモ）。実ドメインではない — 形式化の最初のセッションで丸ごと置き換える。
  メモ — 具体構造体 + ふるまいの def + @[contract] 定理群（Entity 単体テストの生成源）。
  同一性（NoteId）と書き手（UserId）の表現は型パラメータで抽象のまま（決めるのは実装側）。
-/
import Sprout.Domain.Annotations
import Sprout.Domain.ValueObject
import Sprout.Domain.Error

namespace Sprout.Domain

open Sprout

/-- メモ。書いた本人だけが閉じられる。閉じたメモは消えない（削除は存在しない）。 -/
@[aggregateRoot]
structure Note (NoteId UserId : Type) where
  id     : NoteId
  author : UserId
  title  : Title
  closed : Bool
deriving Repr, DecidableEq

variable {NoteId UserId : Type}

/-- 書く（採番は呼び出し側の関心）。 -/
def Note.post (id : NoteId) (author : UserId) (title : Title) : Note NoteId UserId :=
  { id, author, title, closed := false }

/-- 閉じる。もう閉じているメモは閉じられない — メモ自身の規則で、メモ自身が断る。 -/
def Note.close (n : Note NoteId UserId) : Except DomainError (Note NoteId UserId) :=
  if n.closed then .error .alreadyClosed else .ok { n with closed := true }

def Note.isOpen (n : Note NoteId UserId) : Bool := !n.closed

/-! ### 契約定理（受け入れる枝・断る枝 — 1 定理 1 概念。受け入れた値の全体がオラクルなので、同一性・書き手・題が変わらないことも含む） -/

/-- 書いた直後は開いている。 -/
@[contract] theorem Note.post_isOpen (id : NoteId) (a : UserId) (t : Title) :
    (Note.post id a t).isOpen = true := rfl

/-- 開いているメモは閉じられ、閉じたメモになる（同一性・書き手・題は変わらない）。 -/
@[contract] theorem Note.close_open (n : Note NoteId UserId) (h : n.closed = false) :
    n.close = .ok { n with closed := true } := by
  simp [Note.close, h]

/-- もう閉じているメモは閉じられない。 -/
@[contract] theorem Note.close_already_closed (n : Note NoteId UserId) (h : n.closed = true) :
    n.close = .error .alreadyClosed := by
  simp [Note.close, h]

/-- 閉じるを適用し、断られたらそのままにしても同一性は変わらない（観測モデルの点更新に渡す形）。
    @[contract] は付けない — 証明の分解装置。 -/
theorem Note.close_getD_id (n : Note NoteId UserId) : (n.close.toOption.getD n).id = n.id := by
  unfold Note.close; split <;> rfl

/-- 同じく題も変わらない。@[contract] は付けない — 証明の分解装置。 -/
theorem Note.close_getD_title (n : Note NoteId UserId) : (n.close.toOption.getD n).title = n.title := by
  unfold Note.close; split <;> rfl

end Sprout.Domain
