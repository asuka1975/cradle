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
  /-- まだ退出していない（精算は退出の後）。 -/
  | notYetLeft
  /-- その来訪には未確定の決済の試みがある。 -/
  | paymentInProgress
  /-- 宛先の決済の試みが無い（無関係な通知・契機）。 -/
  | unknownAttempt
  /-- まだ送っていない試みへの結果の通知（無関係な結果）。 -/
  | unexpectedResult
  /-- 送れる状態ではない（受付済み・確定済み・結果不明からは送り直さない）。 -/
  | attemptNotDispatchable
  /-- 確定した結果と矛盾する通知（上書きしない）。 -/
  | contradictingResult
  /-- 照会する状態（送る印つき・結果不明・通知待ち）ではない。 -/
  | attemptNotInquirable
deriving Repr, DecidableEq

end Lobby
