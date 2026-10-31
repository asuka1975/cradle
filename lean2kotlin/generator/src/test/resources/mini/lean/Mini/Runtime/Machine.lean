/-
  状態の器（非規範 — golden の都合）。集約ルートごとのコレクション。名義・時計は境界の持ち物で、状態には含めない。
-/
import Mini.Application.RepositoryState
import Mini.Runtime.Ids

namespace Mini.Runtime

open Mini Mini.Application

structure Snapshot where
  books : BookRepositoryState BookId
deriving Repr, DecidableEq

end Mini.Runtime
