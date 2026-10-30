package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Sprout と Lobby のスナップショットに出ない生成の枝を通す最小ドメイン(src/test/resources/mini の Mini)の
 * IR と golden を通した生成の全体を、mini/generated(コミット済みのスナップショット)と突き合わせる。
 */
class MiniGenerationTest {

	private val snapshot: Path = testResources.resolve("mini/generated")

	private fun log(out: Path): List<String> =
		generationLog(miniIr(), Golden.load(testResources.resolve("mini/golden")), "dev.cradle.mini", out)

	@Test
	fun `生成されるファイルの一覧と本文は mini の generated と一致する`(@TempDir out: Path) {
		log(out)
		// 採り直し(src/test/resources/README.md の mini/): 消えたファイルを残さないよう generated ごと生成物で置き換える
		if (System.getProperty("lean2kotlin.updateMiniSnapshot") == "true") {
			snapshot.toFile().deleteRecursively()
			out.toFile().copyRecursively(snapshot.toFile())
		}
		assertSnapshotMatches(snapshot, out)
	}

	// 集合では見えない出る順・字下げ・note 以外の行まで固定する(生成の呼び順を組み替えると落ちる)
	@Test
	fun `ログの全行は出る順と字下げまで既知の列と一致する`(@TempDir out: Path) {
		val expected = listOf(
			"note: View→ドメイン語彙の壁の破れ: Mini.Application.CatalogEntry が interface 化された語彙(Mini.Title 経由)を運んでいます — 期待値の比較が成立しないため該当の参照系ケースは生成されません(モデル側で View 自身の語彙を導入してください)",
			"  note: Clock: 時計ポート — 生成しない(実装は java.time.Clock を直接注入。契約テストは固定 today を配線)",
			"  note: BookRepositoryState: State のふるまいは Kotlin に写さない(Lean 側の意味論装置)",
			"  note: CatalogEntry: 本番語彙が entity-like へ到達するため Arb は生成しない(View→ドメイン語彙の壁)",
			"  note: TitleRow: 本番語彙が entity-like へ到達するため Arb は生成しない(View→ドメイン語彙の壁)",
			"  note: Retrieve テスト: ReadModel 3 種 — golden+射影定理で 2 ケース",
			"  note: 契約定理テスト: LendBookUseCase — 定理 5 本から 17 ケース(遷移形 — Repository 直参照)",
			"  note: LoansUseCase.execute: 引数を合成できないため basic-init をスキップ",
			"  note: 契約テスト: LoansUseCase — golden+定理で 4 ケース(参照系)",
			"  note: CatalogUseCase: View→ドメイン語彙の壁の破れ(期待値が interface 化された語彙を運ぶ)— 参照系ケースは生成できません(モデル側の是正待ち)",
			"  note: 契約テスト: CatalogUseCase — golden+定理で 0 ケース(参照系)",
			"  note: 契約テスト: ShelfUseCase — golden+定理で 1 ケース(参照系)",
			"  note: 契約定理テスト: ConditionBehaviors — 定理 1 本から 3 ケース(純値形)",
			"  note: 契約定理テスト: Book(Entity)— 定理 3 本から 12 ケース",
			"  note: 契約定理テスト: Title(Entity)— 定理 1 本から 4 ケース",
			"  note: 障害契約テスト: LendBookUseCase — 1 宣言から 2 ケース(障害注入フックつき)",
			"生成完了: main 26 ファイル -> <out>/kotlin-main / test 17 ファイル -> <out>/kotlin-test",
		)
		assertEquals(expected, normalizedLog(log(out), out))
	}
}
