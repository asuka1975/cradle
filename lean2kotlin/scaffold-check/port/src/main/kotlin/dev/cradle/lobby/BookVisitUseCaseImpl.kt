package dev.cradle.lobby

import dev.cradle.lobby.application.VisitIdGenerator
import dev.cradle.lobby.application.port.organizationdirectory.OrganizationDirectory
import dev.cradle.lobby.application.port.organizationdirectory.OrganizationDirectoryFindMemberOutcome
import dev.cradle.lobby.application.port.organizationdirectory.OrganizationDirectoryFindMemberRequest
import dev.cradle.lobby.application.usecase.bookvisitusecase.BookVisitCommand
import dev.cradle.lobby.application.usecase.bookvisitusecase.BookVisitUseCase
import dev.cradle.lobby.application.usecase.bookvisitusecase.BookVisitVacant
import dev.cradle.lobby.domain.DomainError
import dev.cradle.lobby.domain.repository.VisitRepository
import dev.cradle.lobby.domain.valueobject.VisitPhase

/** `Lobby.Application.BookVisitUseCase` の写し。validate → 要求（`mkRequest`）→ Port → 観測の反映（`apply`）の順で、外部を呼ぶのは validate が通ってから。判断は名義に依らない。 */
class BookVisitUseCaseImpl(
	private val visitRepository: VisitRepository,
	private val organizationDirectory: OrganizationDirectory,
	private val visitIdGenerator: VisitIdGenerator,
) : BookVisitUseCase {
	override fun validate(c: BookVisitCommand): DomainResult<DomainError, BookVisitVacant> =
		if (!c.visitor.valid()) DomainResult.Err(DomainError.EmptyVisitor)
		else if (visitRepository.findAll().any { it.phase != VisitPhase.Left }) DomainResult.Err(DomainError.LobbyOccupied)
		else DomainResult.Ok(BookVisitVacant)

	override fun execute(c: BookVisitCommand): DomainResult<DomainError, Unit> =
		when (val v = validate(c)) {
			is DomainResult.Err -> v
			is DomainResult.Ok ->
				when (val outcome = organizationDirectory.findMember(OrganizationDirectoryFindMemberRequest(employee = c.host))) {
					is OrganizationDirectoryFindMemberOutcome.Missing -> DomainResult.Err(DomainError.HostMissing)
					is OrganizationDirectoryFindMemberOutcome.Unavailable -> DomainResult.Err(DomainError.DirectoryUnavailable)
					is OrganizationDirectoryFindMemberOutcome.Found ->
						if (!outcome.member.active) DomainResult.Err(DomainError.HostInactive)
						else {
							visitRepository.add(VisitImpl(visitIdGenerator.nextId(), c.host, outcome.member.name, c.visitor, VisitPhase.Expected))
							DomainResult.Ok(Unit)
						}
				}
		}
}
