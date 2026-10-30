package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 契約テストのクラス KDoc は、同じクラスが宣言するフックと、@Test が検査する操作だけを名指す(検査する操作が無ければそう書く)。 */
class ContractKdocTest {

	private fun emitTests(ir: Ir, out: Path) =
		EmitTests(ir, Kotlinize(ir), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), emptyList()) {}.emitAll()

	@Test
	fun `遷移契約の KDoc は空のリポジトリを返すフックを集約ごとの名前で名指す`(@TempDir out: Path) {
		emitTests(lobbyIr(), out.resolve("lobby"))
		emitTests(miniIr(), out.resolve("mini"))
		for ((file, hooks) in listOf(
			"lobby/application/usecase/startpaymentusecase/StartPaymentUseCaseContractTest.kt" to
				listOf("paymentAttemptRepository", "visitRepository"),
			"mini/application/usecase/lendbookusecase/LendBookUseCaseContractTest.kt" to listOf("bookRepository"),
		)) {
			val text = out.resolve(file).readText()
			assertTrue(" * (findAll — 並びは保存順)で突き合わせる。${hooks.joinToString("・") { "$it()" }} は\n" +
				" * **呼び出しごとに空のリポジトリ**を返すこと。" in text, text)
			for (hook in hooks) assertTrue("\tprotected abstract fun $hook(): " in text, text)
			assertFalse(" repository() は" in text, text)
		}
	}

	@Test
	fun `Repository 契約の KDoc の規約は interface に無い save を名指さず、検査する操作を書く`(@TempDir out: Path) {
		emitTests(miniIr(), out)
		val text = out.resolve("domain/repository/BookRepositoryContractTest.kt").readText()
		assertTrue(" * BookRepository の契約テスト(v1 規約: add は末尾への追加・update は id で既存個体を書き換えて並びを保つ・" +
			"findById は id で引いて未知なら null)。\n" in text, text)
		assertFalse("save" in text, text)
	}

	@Test
	fun `Repository 契約の規約は @Test と同じ条件で操作を書き、add の無い Repository は update を、@Test の無いクラスは操作を名指さない`() {
		fun rule(find: Boolean, add: Boolean, update: Boolean) = repositoryContractRule(Kotlinize.RepoOps(find, add, update), "id")
		assertEquals("add は末尾への追加・findById は id で引いて未知なら null", rule(find = true, add = true, update = false))
		assertEquals("add は末尾への追加・update は id で既存個体を書き換えて並びを保つ", rule(find = false, add = true, update = true))
		assertEquals("findById は未知の id なら null", rule(find = true, add = false, update = true))
		assertEquals("検査する操作なし", rule(find = false, add = false, update = true))
	}
}
