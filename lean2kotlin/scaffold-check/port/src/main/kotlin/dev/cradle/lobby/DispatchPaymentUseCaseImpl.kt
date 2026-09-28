package dev.cradle.lobby

import dev.cradle.lobby.application.port.paymentgateway.PaymentGateway
import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayAuthorizeRequest
import dev.cradle.lobby.application.usecase.dispatchpaymentusecase.DispatchPaymentObservation
import dev.cradle.lobby.application.usecase.dispatchpaymentusecase.DispatchPaymentUseCase
import dev.cradle.lobby.domain.DomainError
import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository
import dev.cradle.lobby.domain.valueobject.PaymentPhase

/** `Lobby.Application.DispatchPaymentUseCase` の写し。validate → 送る印を保存 → 要求（`mkRequest`）→ Port → 観測の反映（判断 `reflect` は `DispatchPaymentRulesImpl`）の順。印を保存してから送るので、中断しても同じ冪等キーで再開できる。 */
class DispatchPaymentUseCaseImpl(
	private val paymentAttemptRepository: PaymentAttemptRepository,
	private val paymentGateway: PaymentGateway,
) : DispatchPaymentUseCase {
	override fun validate(o: DispatchPaymentObservation): DomainResult<DomainError, PaymentAttempt> {
		val a = paymentAttemptRepository.findById(o.attempt) ?: return DomainResult.Err(DomainError.UnknownAttempt)
		return if (a.phase == PaymentPhase.Pending) DomainResult.Ok(a) else DomainResult.Err(DomainError.AttemptNotDispatchable)
	}

	override fun execute(o: DispatchPaymentObservation): DomainResult<DomainError, Unit> =
		when (val v = validate(o)) {
			is DomainResult.Err -> v
			is DomainResult.Ok -> {
				val a = v.value
				val marked = a.markSending()
				paymentAttemptRepository.update(marked)
				val outcome = paymentGateway.authorize(PaymentGatewayAuthorizeRequest(attempt = a.id, amount = a.amount, attemptNo = marked.tries))
				paymentAttemptRepository.update(DispatchPaymentRulesImpl.reflect(outcome, a))
				DomainResult.Ok(Unit)
			}
		}
}
