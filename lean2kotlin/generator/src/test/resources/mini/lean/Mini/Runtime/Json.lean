/-
  語彙型への JSON の後付け（境界の関心）。仕様層は ToJson / FromJson を deriving しない。
  ワイヤ形式は境界の契約であり、golden がそれを守る。
-/
import Lean
import Mini.Runtime.Views

namespace Mini.Runtime

open Lean Mini Mini.Domain Mini.Application

/-- ドメインの日付のワイヤ形式: ISO-8601 `"uuuu-MM-dd"`（決定的）。 -/
instance : ToJson Date where
  toJson d := Json.str d.toLeanDateString

deriving instance ToJson for BookId
deriving instance ToJson for Mini.Title
deriving instance ToJson for Mini.Condition
deriving instance ToJson for Mini.Place
deriving instance ToJson for Mini.Edition
deriving instance ToJson for Mini.Domain.Book
deriving instance ToJson for Mini.Application.BookView
deriving instance ToJson for Mini.Application.CatalogEntry

/-! ### 状態のワイヤ形式（集約ルートごとのコレクションが平場に並ぶ） -/

instance : ToJson Snapshot where
  toJson s := Json.mkObj [("books", toJson s.books.books)]

instance : ToJson Views where
  toJson v := Json.mkObj [("shelf", toJson v.shelf), ("catalog", toJson v.catalog), ("loans", toJson v.loans)]

end Mini.Runtime
