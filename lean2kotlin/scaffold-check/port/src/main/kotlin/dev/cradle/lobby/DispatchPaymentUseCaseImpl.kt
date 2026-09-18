package dev.cradle.lobby

import dev.cradle.lobby.application.port.paymentgateway.PaymentGateway
import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayAuthorizeOutcome
import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayAuthorizeRequest
import dev.cradle.lobby.application.usecase.dispatchpaymentusecase.DispatchPaymentObservation
import dev.cradle.lobby.application.usecase.dispatchpaymentusecase.DispatchPaymentUseCase
import dev.cradle.lobby.domain.DomainError
import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository
import dev.cradle.lobby.domain.valueobject.PaymentPhase
import dev.cradle.lobby.domain.valueobject.PaymentResult

/** `Lobby.Application.DispatchPaymentUseCase` の写し。validate → 送る印を保存 → 要求（`mkRequest`）→ Port → 観測の反映（`reflect`）の順。印を保存してから送るので、中断しても同じ冪等キーで再開できる。 */
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
				val reflected = when (paymentGateway.authorize(PaymentGatewayAuthorizeRequest(attempt = a.id, amount = a.amount, attemptNo = marked.tries))) {
					PaymentGatewayAuthorizeOutcome.Authorized -> marked.settle(PaymentResult.Authorized)
					PaymentGatewayAuthorizeOutcome.Declined -> marked.settle(PaymentResult.Declined)
					PaymentGatewayAuthorizeOutcome.Accepted -> marked.awaitConfirmation()
					PaymentGatewayAuthorizeOutcome.Unavailable -> marked.resetPending()
					PaymentGatewayAuthorizeOutcome.Unknown -> marked.lose()
				}
				paymentAttemptRepository.update(reflected)
				DomainResult.Ok(Unit)
			}
		}
}
