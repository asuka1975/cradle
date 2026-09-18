package dev.cradle.lobby

import dev.cradle.lobby.application.port.paymentgateway.PaymentGateway
import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayInquireOutcome
import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayInquireRequest
import dev.cradle.lobby.application.usecase.inquirepaymentusecase.InquirePaymentObservation
import dev.cradle.lobby.application.usecase.inquirepaymentusecase.InquirePaymentUseCase
import dev.cradle.lobby.domain.DomainError
import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository
import dev.cradle.lobby.domain.valueobject.PaymentPhase

/** `Lobby.Application.InquirePaymentUseCase` の写し。validate → 要求（`mkRequest`）→ Port → 観測の反映（`reflect`）の順で、照会するのは結果不明の試みだけ。 */
class InquirePaymentUseCaseImpl(
	private val paymentAttemptRepository: PaymentAttemptRepository,
	private val paymentGateway: PaymentGateway,
) : InquirePaymentUseCase {
	override fun validate(o: InquirePaymentObservation): DomainResult<DomainError, PaymentAttempt> {
		val a = paymentAttemptRepository.findById(o.attempt) ?: return DomainResult.Err(DomainError.UnknownAttempt)
		return if (a.phase == PaymentPhase.Unknown) DomainResult.Ok(a) else DomainResult.Err(DomainError.AttemptNotInquirable)
	}

	override fun execute(o: InquirePaymentObservation): DomainResult<DomainError, Unit> =
		when (val v = validate(o)) {
			is DomainResult.Err -> v
			is DomainResult.Ok -> {
				val a = v.value
				val reflected = when (val outcome = paymentGateway.inquire(PaymentGatewayInquireRequest(attempt = a.id))) {
					is PaymentGatewayInquireOutcome.Settled -> a.settle(outcome.result)
					is PaymentGatewayInquireOutcome.NotFound -> a.resetPending()
					is PaymentGatewayInquireOutcome.Unavailable -> a
				}
				paymentAttemptRepository.update(reflected)
				DomainResult.Ok(Unit)
			}
		}
}
