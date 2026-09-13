/-
  境界（非規範）: 直列化できる状態 Snapshot・検査 check・ルーティング表 apply。
  大域の遷移・大域の不変条件は書かない — apply の各腕は UseCase の execute への 1 行のパススルー。
  時計（today）と名義（actor）は境界の持ち物で、状態には含めない。
-/
import Sprout.Runtime.Command
import Sprout.Application.UseCase.PostNoteUseCase.UseCase
import Sprout.Application.UseCase.CloseNoteUseCase.UseCase

namespace Sprout.Runtime

open Sprout Sprout.Domain Sprout.Application

/-- 直列化できる世界の状態: 集約ルートごとのコレクション + 泉の残高だけ。 -/
structure Snapshot where
  notes   : Notes
  noteIds : NoteIdGeneratorState
deriving Repr, DecidableEq

def Snapshot.empty : Snapshot := ⟨⟨[], by decide, by decide⟩, ⟨0⟩⟩
instance : Inhabited Snapshot := ⟨Snapshot.empty⟩

/-- 泉の境界検査: 既に使われている同一性は残高より小さい（= 次に汲む値は新鮮）。 -/
def Snapshot.bounds (s : Snapshot) : Bool :=
  s.notes.notes.all (fun n => decide (n.id.id < s.noteIds.next))

/-- 外から受け取った状態の検査。集約ルートの制約（同一性の一意性）は観測モデルの構造が運ぶので、
    検査するのは泉の境界だけ。 -/
def Snapshot.check (s : Snapshot) : Bool := s.bounds

/-- 検査を通った状態では、泉から次に汲む値は新鮮（UseCase が要求する泉の契約）。 -/
theorem Snapshot.fresh (s : Snapshot) (h : s.check = true) :
    noteFountain.Fresh s.noteIds s.notes.ids := by
  intro hmem
  simp only [NoteRepositoryState.ids, List.mem_map] at hmem
  obtain ⟨n, hn, hid⟩ := hmem
  have := (List.all_eq_true.mp h) n hn
  simp only [decide_eq_true_eq] at this
  have : n.id.id < s.noteIds.next := this
  rw [hid] at this
  exact absurd this (Nat.lt_irrefl _)

/-- 名義が届いた帰結（コマンドではない）。既定では何もしない —
    「開くたびに写す」類の帰結があるドメインはここに書く。 -/
def Snapshot.opened (_actor : Actor) (s : Snapshot) : Snapshot := s

/-- 帰結は検査を保つ（帰結を書くドメインはここで証明する）。 -/
theorem Snapshot.opened_check (actor : Actor) (s : Snapshot) (h : s.check = true) :
    (s.opened actor).check = true := h

/-- ルーティング: コマンドごとの殻へ、名義を実行文脈として渡す。検査を通った状態だけを受ける —
    泉から汲む UseCase にはそこから作った新鮮性の証明を渡す。
    コマンドを増やす手順: UseCase ディレクトリを作る → Command.lean に構成子を足す
    （match 非網羅でビルドが落ちて気づく）→ ここに腕を足す。 -/
def Snapshot.applyCommand (_today : Date) (actor : Actor) (cmd : Command) (s : Snapshot)
    (h : s.check = true) : Except DomainError Snapshot :=
  match cmd with
  | .postNote c =>
    (PostNoteUseCase.execute actor.context noteFountain c ⟨s.notes, s.noteIds⟩ (Snapshot.fresh s h)).map
      (fun st => ⟨st.notes, st.noteIds⟩)
  | .closeNote c =>
    (CloseNoteUseCase.execute actor.context c s.notes).map (fun st => ⟨st, s.noteIds⟩)

/-- 開く → コマンドを配る。 -/
def Snapshot.apply (today : Date) (actor : Actor) (cmd : Command) (s : Snapshot)
    (h : s.check = true) : Except DomainError Snapshot :=
  Snapshot.applyCommand today actor cmd (s.opened actor) (Snapshot.opened_check actor s h)

end Sprout.Runtime
