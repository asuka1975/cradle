/-
  失敗の語彙（1 分岐 1 構成子）。外部の観測に由来する失敗も業務の語彙で言う。
-/
import Lobby.Domain.Annotations

namespace Lobby

/-- 業務としての失敗。技術的障害はこの語彙に含めない。 -/
inductive DomainError where
  /-- 来訪者の名前が空。 -/
  | emptyVisitor
  /-- 受入担当者がディレクトリに無い。 -/
  | hostMissing
  /-- ディレクトリが答えない（不在とは別の事実）。 -/
  | directoryUnavailable
  /-- 受入担当者が在籍していない。 -/
  | hostInactive
  /-- ロビーはひと組ずつ受け入れる（受付中の来訪がある）。 -/
  | lobbyOccupied
  /-- 宛先の来訪が無い。 -/
  | unknownVisit
  /-- もう退出している。 -/
  | alreadyLeft
deriving Repr, DecidableEq

end Lobby
