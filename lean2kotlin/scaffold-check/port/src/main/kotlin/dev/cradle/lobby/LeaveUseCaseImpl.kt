package dev.cradle.lobby

import dev.cradle.lobby.application.usecase.leaveusecase.LeaveCommand
import dev.cradle.lobby.application.usecase.leaveusecase.LeaveUseCase
import dev.cradle.lobby.domain.DomainError
import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.repository.VisitRepository
import dev.cradle.lobby.domain.valueobject.VisitPhase

/** `Lobby.Application.LeaveUseCase` の写し。validate が宛先を解決し、execute はその来訪を退出させる。判断は名義に依らない。 */
class LeaveUseCaseImpl(
	private val visitRepository: VisitRepository,
) : LeaveUseCase {
	override fun validate(c: LeaveCommand): DomainResult<DomainError, Visit> {
		val v = visitRepository.findById(c.visit) ?: return DomainResult.Err(DomainError.UnknownVisit)
		return if (v.phase == VisitPhase.Left) DomainResult.Err(DomainError.AlreadyLeft) else DomainResult.Ok(v)
	}

	override fun execute(c: LeaveCommand): DomainResult<DomainError, Unit> =
		when (val v = validate(c)) {
			is DomainResult.Err -> v
			is DomainResult.Ok -> {
				visitRepository.update(v.value.leave())
				DomainResult.Ok(Unit)
			}
		}
}
