package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 契約テストのクラス KDoc は、同じクラスが宣言するフックだけを名指す。 */
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
}
