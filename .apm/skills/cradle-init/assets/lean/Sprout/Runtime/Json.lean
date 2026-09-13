/-
  語彙型への JSON の後付け（境界の関心）。仕様層は ToJson / FromJson を deriving しない。
  ワイヤ形式は境界の契約であり、golden とモックアップ・CLI がそれを守る。
-/
import Lean
import Sprout.Runtime.Views

namespace Sprout.Runtime

open Lean

deriving instance ToJson, FromJson for NoteId
deriving instance ToJson, FromJson for UserId
deriving instance ToJson, FromJson for Sprout.Application.NoteIdGeneratorState
deriving instance ToJson for Sprout.Title

/-- 題の文字列をそのまま受ける（`{"text": …}` も受ける）。 -/
instance : FromJson Sprout.Title where
  fromJson?
    | .str s => pure ⟨s⟩
    | j      => do
      let s ← (← j.getObjVal? "text").getStr?
      pure ⟨s⟩

deriving instance ToJson, FromJson for Sprout.DomainError
deriving instance ToJson, FromJson for Sprout.Application.QueryError
deriving instance ToJson, FromJson for Sprout.Domain.Note
deriving instance ToJson, FromJson for Sprout.Application.NoteView
deriving instance ToJson, FromJson for Views
deriving instance ToJson, FromJson for Sprout.Application.PostNoteUseCase.Command
deriving instance ToJson, FromJson for Sprout.Application.CloseNoteUseCase.Command

/-- ドメインの日付のワイヤ形式: ISO-8601 `"uuuu-MM-dd"`（決定的）。 -/
instance : ToJson Sprout.Date where
  toJson d := Json.str d.toLeanDateString

/-- 暦として実在する日付だけが構築できる（構築時執行の、境界での現れ方）。 -/
instance : FromJson Sprout.Date where
  fromJson? j := do
    let s ← j.getStr?
    match Std.Time.PlainDate.fromLeanDateString s with
    | .ok d    => pure d
    | .error e => throw s!"invalid date '{s}' (expected ISO-8601 uuuu-MM-dd): {e}"

/-! ### 状態のワイヤ形式（集約ルートごとのコレクションが平場に並ぶ + 泉の残高） -/

instance : ToJson Snapshot where
  toJson s := Json.mkObj [("notes", toJson s.notes.notes), ("noteIds", toJson s.noteIds)]

/-- 観測モデルの制約（同一性と題の一意性）は構築時に要るので、境界で決定して弾く。 -/
instance : FromJson Snapshot where
  fromJson? j := do
    let notes ← (j.getObjVal? "notes") >>= fromJson? (α := List Note)
    let noteIds ← (j.getObjVal? "noteIds") >>= fromJson? (α := Application.NoteIdGeneratorState)
    if hid : (notes.map (·.id)).Nodup then
      if ht : (notes.map (·.title)).Nodup then pure ⟨⟨notes, hid, ht⟩, noteIds⟩
      else throw "state.notes: duplicate title"
    else throw "state.notes: duplicate id"

/-! ### 名義のワイヤ形式: `{"user": {"id": 1}}` — コマンドとは別に運ぶ -/

instance : ToJson Actor where
  toJson a := Json.mkObj [("user", toJson a.context.user)]

instance : FromJson Actor where
  fromJson? j :=
    match (j.getObjVal? "user").toOption with
    | some uv => (fromJson? (α := UserId) uv).map (fun u => ⟨⟨u⟩⟩)
    | none    => .error "actor requires user"

/-! ### コマンドのワイヤ形式（手書きで平らに固定）: `{"<構成子名>": <ペイロード>}` -/

private def tagged (tag : String) (payload : Json) : Json := Json.mkObj [(tag, payload)]

instance : ToJson Command where
  toJson
    | .postNote c  => tagged "postNote" (toJson c)
    | .closeNote c => tagged "closeNote" (toJson c)

instance : FromJson Command where
  fromJson? j :=
    match (j.getObjVal? "postNote").toOption, (j.getObjVal? "closeNote").toOption with
    | some p, _ => (fromJson? p).map Command.postNote
    | _, some p => (fromJson? p).map Command.closeNote
    | none, none => .error "unknown command (expected one of: postNote, closeNote)"

end Sprout.Runtime
