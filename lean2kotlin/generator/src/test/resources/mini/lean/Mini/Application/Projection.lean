/-
  書き込みモデル → 読み取り行の射影（Entity を読んでよい読み側）。
-/
import Mini.Application.ReadModel
import Mini.Application.RepositoryState

namespace Mini.Application

open Mini Mini.Domain

variable {BookId : Type}

def toBookRow (b : Book BookId) : BookRow BookId :=
  { id := b.id, condition := b.condition, lentOn := b.lentOn }

/-- 本の行（棚に並べた順のまま）。 -/
def bookRows (s : BookRepositoryState BookId) : List (BookRow BookId) :=
  s.books.map toBookRow

def toTitleRow (b : Book BookId) : TitleRow BookId :=
  { book := b.id, title := b.edition.title }

/-- 題の行（棚に並べた順のまま）。 -/
def titleRows (s : BookRepositoryState BookId) : List (TitleRow BookId) :=
  s.books.map toTitleRow

end Mini.Application
