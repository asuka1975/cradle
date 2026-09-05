/-
  Cradle の骨格のサンプルドメイン（メモ）。実ドメインではない — 形式化の最初のセッションで丸ごと置き換える。
  メモ — 具体構造体 + ふるまいの def + @[contract] 定理群（Entity 単体テストの生成源）。
  同一性（NoteId）と書き手（UserId）の表現は型パラメータで抽象のまま（決めるのは実装側）。
-/
import Sprout.Domain.Annotations
import Sprout.Domain.ValueObject

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

/-- 閉じる。 -/
def Note.close (n : Note NoteId UserId) : Note NoteId UserId := { n with closed := true }

def Note.isOpen (n : Note NoteId UserId) : Bool := !n.closed

/-! ### 契約定理（効果・非効果・同一性 — 1 定理 1 概念） -/

/-- 書いた直後は開いている。 -/
@[contract] theorem Note.post_isOpen (id : NoteId) (a : UserId) (t : Title) :
    (Note.post id a t).isOpen = true := rfl

/-- 閉じても同一性は変わらない。 -/
@[contract] theorem Note.close_id (n : Note NoteId UserId) : n.close.id = n.id := rfl

/-- 閉じたら閉じている。 -/
@[contract] theorem Note.close_closed (n : Note NoteId UserId) : n.close.closed = true := rfl

/-- 閉じても書き手と題は変わらない（フレーム）。 -/
@[contract] theorem Note.close_frame (n : Note NoteId UserId) :
    n.close.author = n.author ∧ n.close.title = n.title := ⟨rfl, rfl⟩

/-- 閉じるのは冪等。 -/
@[contract] theorem Note.close_idem (n : Note NoteId UserId) : n.close.close = n.close := rfl

end Sprout.Domain
