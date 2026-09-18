package dev.cradle.lobby

import dev.cradle.lobby.application.ActorContext
import dev.cradle.lobby.application.VisitIdGenerator
import dev.cradle.lobby.application.port.organizationdirectory.OrganizationDirectory
import dev.cradle.lobby.application.port.organizationdirectory.OrganizationDirectoryFindMemberOutcome
import dev.cradle.lobby.application.port.organizationdirectory.OrganizationDirectoryFindMemberRequest
import dev.cradle.lobby.application.usecase.bookvisitusecase.BookVisitCommand
import dev.cradle.lobby.application.usecase.bookvisitusecase.BookVisitUseCase
import dev.cradle.lobby.application.usecase.bookvisitusecase.BookVisitUseCaseContractTest
import dev.cradle.lobby.application.usecase.bookvisitusecase.BookVisitVacant
import dev.cradle.lobby.domain.DomainError
import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.repository.VisitRepository
import dev.cradle.lobby.domain.valueobject.VisitorName
import dev.cradle.lobby.runtime.EmployeeId
import java.lang.reflect.InvocationTargetException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Port の使い方を誤った実装が、生成された契約テストで赤くなることの検査。
 * 契約テストの各メソッドを誤実装に対して走らせ、失敗の理由がモックの記録（要求不一致・積んでいない呼び出し・
 * 呼ばれなかった要求）であることを確かめる。正しい実装は BookVisitUseCaseContractTestImpl が通す。
 */
class WrongPortUseTest {
	/** 契約テストの各 @Test を走らせ、失敗した（メソッド名 → 例外）だけを返す。 */
	private fun failuresOf(t: BookVisitUseCaseContractTest): Map<String, Throwable> =
		t::class.java.methods.filter { it.isAnnotationPresent(Test::class.java) }.mapNotNull { m ->
			runCatching { m.invoke(t) }.exceptionOrNull()?.let { m.name to ((it as? InvocationTargetException)?.targetException ?: it) }
		}.toMap()

	private abstract class Harness(private val make: (VisitRepository, OrganizationDirectory, VisitIdGenerator, ActorContext) -> BookVisitUseCase) : BookVisitUseCaseContractTest() {
		override fun visitRepository(): VisitRepository = InMemoryVisitRepository()
		override fun visit(fixture: VisitFixture): Visit = fixture.materialize()
		override fun visitorName(fixture: VisitorNameFixture): VisitorName = fixture.materialize()
		override fun useCase(visitRepository: VisitRepository, organizationDirectory: OrganizationDirectory, visitIdGenerator: VisitIdGenerator, actor: ActorContext): BookVisitUseCase =
			make(visitRepository, organizationDirectory, visitIdGenerator, actor)
	}

	/** 外部を呼ばず「見つかった・在籍」を決め打つ実装。 */
	private class NeverAsks : Harness({ repo, _, gen, _ ->
		object : BookVisitUseCase {
			private val real = BookVisitUseCaseImpl(repo, OrganizationDirectoryAlwaysFound, gen)
			override fun validate(c: BookVisitCommand): DomainResult<DomainError, BookVisitVacant> = real.validate(c)
			override fun execute(c: BookVisitCommand): DomainResult<DomainError, Unit> = real.execute(c)
		}
	})

	/** 受入担当者ではなく別の社員を引く実装（要求が違う）。 */
	private class AsksWrongEmployee : Harness({ repo, dir, gen, actor ->
		BookVisitUseCaseImpl(repo, object : OrganizationDirectory {
			override fun findMember(request: OrganizationDirectoryFindMemberRequest) = dir.findMember(OrganizationDirectoryFindMemberRequest(EmployeeId(request.employee.id + 1000L)))
		}, gen)
	})

	/** 同じ要求を 2 回投げる実装。 */
	private class AsksTwice : Harness({ repo, dir, gen, actor ->
		BookVisitUseCaseImpl(repo, object : OrganizationDirectory {
			override fun findMember(request: OrganizationDirectoryFindMemberRequest): OrganizationDirectoryFindMemberOutcome {
				dir.findMember(request)
				return dir.findMember(request)
			}
		}, gen)
	})

	/** validate より先に外部を呼ぶ実装（拒否される入力でも 1 回呼んでしまう。呼ぶのは 1 回だけ）。 */
	private class AsksBeforeValidate : Harness({ repo, dir, gen, actor ->
		object : BookVisitUseCase {
			private val real = BookVisitUseCaseImpl(repo, dir, gen)
			override fun validate(c: BookVisitCommand): DomainResult<DomainError, BookVisitVacant> = real.validate(c)
			override fun execute(c: BookVisitCommand): DomainResult<DomainError, Unit> {
				val fetched = dir.findMember(OrganizationDirectoryFindMemberRequest(c.host))
				val replay = object : OrganizationDirectory {
					override fun findMember(request: OrganizationDirectoryFindMemberRequest) = fetched
				}
				return BookVisitUseCaseImpl(repo, replay, gen).execute(c)
			}
		}
	})

	/** Port の失敗を握りつぶして「答えない」に化かす実装。 */
	private class SwallowsHarnessFailure : Harness({ repo, dir, gen, actor ->
		BookVisitUseCaseImpl(repo, object : OrganizationDirectory {
			override fun findMember(request: OrganizationDirectoryFindMemberRequest): OrganizationDirectoryFindMemberOutcome =
				try { dir.findMember(OrganizationDirectoryFindMemberRequest(EmployeeId(request.employee.id + 1000L))) }
				catch (t: Throwable) { OrganizationDirectoryFindMemberOutcome.Unavailable }
		}, gen)
	})

	private object OrganizationDirectoryAlwaysFound : OrganizationDirectory {
		override fun findMember(request: OrganizationDirectoryFindMemberRequest) =
			OrganizationDirectoryFindMemberOutcome.Found(dev.cradle.lobby.application.port.organizationdirectory.OrganizationDirectoryFindMemberMember(name = "x", active = true))
	}

	private fun assertAllMention(failures: Map<String, Throwable>, needle: String, atLeast: Int) {
		assertTrue(failures.size >= atLeast, "失敗が少なすぎる: ${failures.keys}")
		for ((name, t) in failures) assertTrue(t.message?.contains(needle) == true, "$name: $t")
	}

	@Test
	fun `正しい実装は全部通る`() {
		assertEquals(emptyMap<String, Throwable>(), failuresOf(BookVisitUseCaseContractTestImpl()))
	}

	@Test
	fun `外部を呼ばない実装は、要求のあるケースで「呼ばれなかった」として赤くなる`() {
		val failures = failuresOf(NeverAsks())
		// 要求が無いケース（validate の拒否）は通り、要求のあるケース（4 定理 × 4 ケース）が全部落ちる
		assertAllMention(failures, "呼ばれなかったやり取りが残っている", 16)
		assertTrue(failures.keys.none { it.contains("execute_empty_visitor") || it.contains("execute_occupied") }, failures.keys.toString())
	}

	@Test
	fun `別の要求で呼ぶ実装は「要求が違う」として赤くなる`() {
		assertAllMention(failuresOf(AsksWrongEmployee()), "要求が違う", 16)
	}

	@Test
	fun `2 回呼ぶ実装は「積んでいない呼び出し」として赤くなる`() {
		assertAllMention(failuresOf(AsksTwice()), "積んでいない呼び出し", 16)
	}

	@Test
	fun `validate より先に呼ぶ実装は、拒否される入力で「積んでいない呼び出し」として赤くなる`() {
		val failures = failuresOf(AsksBeforeValidate())
		assertAllMention(failures, "積んでいない呼び出し", 8)
		assertTrue(failures.keys.all { it.contains("execute_empty_visitor") || it.contains("execute_occupied") }, failures.keys.toString())
	}

	@Test
	fun `Port の失敗を捕捉して業務の観測に化かす実装も、記録が残るので赤くなる`() {
		assertAllMention(failuresOf(SwallowsHarnessFailure()), "要求が違う", 16)
	}
}
