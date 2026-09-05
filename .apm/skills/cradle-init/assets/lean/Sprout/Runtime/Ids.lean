/-
  同一性の表現の**仮置き**（実行・モックアップ・golden のため）。
  ID の実装（連番か UUID か）を決めるのは NFR を根拠にしたインフラ設計であり、
  Domain / Application / 契約定理はこのファイルを import しない。
-/
import Sprout.Application.RepositoryState
import Sprout.Application.ReadModel
import Sprout.Application.View

namespace Sprout.Runtime

open Sprout

structure NoteId where id : Nat
deriving Repr, DecidableEq, Inhabited

/-- 利用者の同一性（発行者は認証基盤 — 泉を持たない）。 -/
@[valueObject]
structure UserId where id : Nat
deriving Repr, DecidableEq, Inhabited

/-! ### 従来名（境界・実行系だけが使う） -/

abbrev Note  := Domain.Note NoteId UserId
abbrev Notes := Application.NoteRepositoryState NoteId UserId

/-- メモの泉の具体化（連番）。 -/
def noteFountain : Application.Fountain Application.NoteIdGeneratorState NoteId :=
  { step := fun s => (⟨s.next⟩, ⟨s.next + 1⟩) }

end Sprout.Runtime
