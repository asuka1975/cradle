package dev.cradle.lobby

import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.valueobject.PaymentAttemptId
import dev.cradle.lobby.domain.valueobject.PaymentPhase
import dev.cradle.lobby.domain.valueobject.PaymentResult
import dev.cradle.lobby.domain.valueobject.VisitId

/** `Lobby.Domain.PaymentAttempt` の写し。各遷移は同一性（冪等キー）を変えずに写しを返し、`markSending` だけが試行番号を進める（送ったかどうか分からない段階 sending にする）。 */
data class PaymentAttemptImpl(
	override val id: PaymentAttemptId,
	override val visit: VisitId,
	override val amount: Long,
	override val tries: Long,
	override val phase: PaymentPhase,
) : PaymentAttempt {
	override fun markSending(): PaymentAttempt = copy(tries = tries + 1, phase = PaymentPhase.Sending)
	override fun settle(r: PaymentResult): PaymentAttempt = copy(phase = phaseOf(r))
	override fun awaitConfirmation(): PaymentAttempt = copy(phase = PaymentPhase.AwaitingConfirmation)
	override fun lose(): PaymentAttempt = copy(phase = PaymentPhase.Unknown)
	override fun resetPending(): PaymentAttempt = copy(phase = PaymentPhase.Pending)
	override fun isSettled(): Boolean = phase == PaymentPhase.Authorized || phase == PaymentPhase.Declined
	override fun isInquirable(): Boolean = phase == PaymentPhase.Sending || phase == PaymentPhase.Unknown || phase == PaymentPhase.AwaitingConfirmation
	override fun settledAs(r: PaymentResult): Boolean = phase == phaseOf(r)

	companion object {
		/** `PaymentAttempt.start` の写し: 送れる状態で、まだ 1 度も送っていない。 */
		fun start(id: PaymentAttemptId, visit: VisitId, amount: Long): PaymentAttemptImpl =
			PaymentAttemptImpl(id, visit, amount, tries = 0L, phase = PaymentPhase.Pending)

		/** 確定結果が導く段階（`settle` / `settledAs` の match）。 */
		private fun phaseOf(r: PaymentResult): PaymentPhase = when (r) {
			PaymentResult.Authorized -> PaymentPhase.Authorized
			PaymentResult.Declined -> PaymentPhase.Declined
		}
	}
}
