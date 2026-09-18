package dev.cradle.lobby

import dev.cradle.lobby.application.usecase.confirmpaymentusecase.ConfirmPaymentObservation
import dev.cradle.lobby.application.usecase.confirmpaymentusecase.ConfirmPaymentUseCase
import dev.cradle.lobby.domain.DomainError
import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository

/** `Lobby.Application.ConfirmPaymentUseCase` の写し。validate が試みを解決して矛盾する通知を断り、execute は通知の結果で確定する（同じ結果の重複は変化なし）。 */
class ConfirmPaymentUseCaseImpl(
	private val paymentAttemptRepository: PaymentAttemptRepository,
) : ConfirmPaymentUseCase {
	override fun validate(o: ConfirmPaymentObservation): DomainResult<DomainError, PaymentAttempt> {
		val a = paymentAttemptRepository.findById(o.attempt) ?: return DomainResult.Err(DomainError.UnknownAttempt)
		return if (a.isSettled() && !a.settledAs(o.result)) DomainResult.Err(DomainError.ContradictingResult) else DomainResult.Ok(a)
	}

	override fun execute(o: ConfirmPaymentObservation): DomainResult<DomainError, Unit> =
		when (val v = validate(o)) {
			is DomainResult.Err -> v
			is DomainResult.Ok -> {
				paymentAttemptRepository.update(v.value.settle(o.result))
				DomainResult.Ok(Unit)
			}
		}
}
