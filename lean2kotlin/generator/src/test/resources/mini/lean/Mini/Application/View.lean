/-
  閲覧の共有語彙（View と参照系の失敗）。UseCase ではない。
  棚の見え方は View 自身の語彙（Bool）で写す。目録の見え方は題をドメインの VO のまま運び、
  View→ドメイン語彙の壁を破る — 壁の破れた参照系を生成側に通すための素材。
-/
import Mini.Domain.ValueObject

namespace Mini.Application

open Mini

/-- 棚の本の見え方。 -/
structure BookView (BookId : Type) where
  id       : BookId
  lendable : Bool
  lent     : Bool
deriving Repr, DecidableEq

/-- 目録の見え方。 -/
structure CatalogEntry (BookId : Type) where
  book  : BookId
  title : Title
deriving Repr, DecidableEq

/-- 参照系の失敗（この素材の参照系は断らない）。 -/
inductive QueryError where
  /-- 一覧を出せない。 -/
  | unavailable
deriving Repr, DecidableEq

end Mini.Application
