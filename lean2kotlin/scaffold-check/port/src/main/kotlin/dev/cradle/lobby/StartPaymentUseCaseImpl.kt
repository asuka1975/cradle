package dev.cradle.lobby

import dev.cradle.lobby.application.PaymentAttemptIdGenerator
import dev.cradle.lobby.application.usecase.startpaymentusecase.StartPaymentCommand
import dev.cradle.lobby.application.usecase.startpaymentusecase.StartPaymentUseCase
import dev.cradle.lobby.domain.DomainError
import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository
import dev.cradle.lobby.domain.repository.VisitRepository

/** `Lobby.Application.StartPaymentUseCase` の写し。validate が来訪を解決し、execute は料金を決めて送れる状態の試みを保存する（外部は呼ばない）。判断は名義に依らない。 */
class StartPaymentUseCaseImpl(
	private val visitRepository: VisitRepository,
	private val paymentAttemptRepository: PaymentAttemptRepository,
	private val paymentAttemptIdGenerator: PaymentAttemptIdGenerator,
) : StartPaymentUseCase {
	override fun validate(c: StartPaymentCommand): DomainResult<DomainError, Visit> {
		val v = visitRepository.findById(c.visit) ?: return DomainResult.Err(DomainError.UnknownVisit)
		return if (!TaxServiceImpl.taxable(v)) DomainResult.Err(DomainError.NotYetLeft)
		else if (paymentAttemptRepository.findAll().any { it.visit == c.visit && !it.isSettled() }) DomainResult.Err(DomainError.PaymentInProgress)
		else DomainResult.Ok(v)
	}

	override fun execute(c: StartPaymentCommand): DomainResult<DomainError, Unit> =
		when (val v = validate(c)) {
			is DomainResult.Err -> v
			is DomainResult.Ok -> {
				paymentAttemptRepository.add(PaymentAttemptImpl.start(paymentAttemptIdGenerator.nextId(), c.visit, PricingServiceImpl.fee(v.value)))
				DomainResult.Ok(Unit)
			}
		}
}
