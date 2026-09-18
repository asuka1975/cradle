package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 外部能力の Port を持つ最小ドメイン(scaffold-check/port の Lobby)の IR を通した生成の全体を、
 * scaffold-check/port/src/generated(実物スナップショット)と突き合わせる。golden は持たない。
 */
class LobbyGenerationTest {

	private val snapshot: Path = Path.of("../scaffold-check/port/src/generated")

	private fun generate(out: Path): List<String> {
		val notes = mutableListOf<String>()
		Lean2KotlinGeneration.generate(
			lobbyIr(), GoldenLoad(emptyList(), listOf("golden の指定なし — golden 由来のケース(参照系の golden 回帰・Retrieve)は生成しません")),
			"dev.cradle.lobby", out.resolve("kotlin-main"), out.resolve("kotlin-test"), out.resolve("kotlin-adapter-test"), "\t") { notes += it.trim() }
		return notes.filter { it.startsWith("note: ") }
	}

	@Test
	fun `生成されるファイルの一覧と本文は scaffold-check port の src generated と一致する`(@TempDir out: Path) {
		generate(out)
		assertSnapshotMatches(snapshot, out)
	}

	@Test
	fun `note の集合は既知の集合と一致し、Port の要求と観測が interface とモックに写る`(@TempDir out: Path) {
		val expected = setOf(
			"note: 泉ポート(泉ごとの IdGenerator ポート): VisitIdGenerator(供給: VisitId)",
			"note: VisitRepositoryState: State のふるまいは Kotlin に写さない(Lean 側の意味論装置)",
			"note: 契約定理テスト: BookVisitUseCase — 定理 6 本から 24 ケース(遷移形 — Repository 直参照)",
			"note: 契約定理テスト: LeaveUseCase — 定理 3 本から 12 ケース(遷移形 — Repository 直参照)",
			"note: 契約定理テスト: Visit(Entity)— 定理 4 本から 16 ケース",
			"note: 契約定理テスト: VisitorName(Entity)— 定理 1 本から 4 ケース",
			"note: 障害契約テスト: BookVisitUseCase — 1 宣言から 4 ケース(障害注入フックつき)",
			"note: golden の指定なし — golden 由来のケース(参照系の golden 回帰・Retrieve)は生成しません",
		)
		val notes = generate(out)
		assertEquals(expected, notes.toSet())
		val port = out.resolve("kotlin-main/application/port/organizationdirectory/OrganizationDirectory.kt").toFile().readText()
		assertTrue("fun findMember(request: OrganizationDirectoryFindMemberRequest): OrganizationDirectoryFindMemberOutcome" in port, port)
		val useCase = out.resolve("kotlin-main/application/usecase/bookvisitusecase/BookVisitUseCase.kt").toFile().readText()
		assertTrue("fun execute(c: BookVisitCommand): DomainResult<DomainError, Unit>" in useCase, useCase)
		val test = out.resolve("kotlin-test/application/usecase/bookvisitusecase/BookVisitUseCaseContractTest.kt").toFile().readText()
		assertTrue("OrganizationDirectoryMock(emptyList())" in test, test)
		assertTrue("OrganizationDirectoryMock(listOf(OrganizationDirectoryMock.FindMember(request = OrganizationDirectoryFindMemberRequest(employee = EmployeeId(id = 4L)), outcome = OrganizationDirectoryFindMemberOutcome.Missing)))" in test, test)
		assertTrue(".also { organizationDirectory.assertComplete() }.getOrThrow()" in test, test)
	}
}
