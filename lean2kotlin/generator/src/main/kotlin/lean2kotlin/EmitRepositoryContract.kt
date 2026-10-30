package lean2kotlin

// ───────────────────────── Repository 契約テスト(規約由来 — Lean 由来ではない)

/** 同一性を持つ集約の Repository 契約テストの規約の一文。@Test を選ぶのと同じ条件で書く(update と findById で
    引けることの検査は add の播種を要る)— interface に無い操作も、検査しない操作も名指さない。add も findById も
    無ければクラスに @Test は無く、findAll も検査しないので、検査する操作が無いとだけ書く。 */
internal fun repositoryContractRule(ops: Kotlinize.RepoOps, idField: String): String = listOfNotNull(
	"add は末尾への追加".takeIf { ops.add },
	"update は $idField で既存個体を書き換えて並びを保つ".takeIf { ops.add && ops.update },
	(if (ops.add) "findById は $idField で引いて未知なら null" else "findById は未知の $idField なら null").takeIf { ops.find },
).ifEmpty { listOf("検査する操作なし") }.joinToString("・")

internal fun EmitTests.emitRepositoryContractTest(td: IrTypeDef) {
	val rootK = td.kotlin
	val framework = junitImports + pbtImports + listOf("org.junit.jupiter.api.Assertions.assertNull")
	emitFile(k.repositoryPackage, "${rootK}RepositoryContractTest", framework = framework) {
		val ops = k.repoOps(td)
		if (td.id == IrType.Unit) {
			val arbRoot = k.arbCall(td.lean)
			"""
/**
 * ${rootK}Repository の契約テスト(v1 規約: 単一保持・上書き)。
 * repository() は**呼び出しごとに空のリポジトリ**を返すこと。
 */
abstract class ${rootK}RepositoryContractTest {
	protected abstract fun repository(): ${rootK}Repository
	/** fixture の実体化(観測が一致する実装の Entity を返す)。 */
	protected abstract fun entity(fixture: ${k.fixtureName(td)}): ${k.name(td.lean)}

	@Test
	fun `保存前の get は null`() {
		assertNull(repository().get())
	}

	@Test
	fun `save したものが get で返り、再 save は上書きする`() {
		runBlocking {
			checkAll(PropTestConfig(seed = 42), $arbRoot, $arbRoot) { a, b ->
				val repo = repository()
				repo.save(entity(a))
				assertEquals(a, repo.get()?.toFixture())
				repo.save(entity(b))
				assertEquals(b, repo.get()?.toFixture())
			}
		}
	}
}
""".trimIndent()
		} else {
			val idField = ident(k.idFieldName(td))
			val arbRepo = k.arbCallOf("${td.kotlin}Repository")
			// update の播種は前後に個体を持つ 1 個体(並びの保持を観測する)+ 書き換えの元になる 1 個体(列の末尾)
			val arbRepo2 = k.arbCallOf("${td.kotlin}Repository", "4..7")
			val constraintDoc = k.rootCollectionOf(td)?.let { rc ->
				" * 個体の列は `${rc.state.lean}` の制約を満たすように引く(${k.arbFunName("${td.kotlin}Repository")})。\n"
			} ?: ""
			"""
/**
 * ${rootK}Repository の契約テスト(v1 規約: ${repositoryContractRule(ops, idField)})。
$constraintDoc * repository() は**呼び出しごとに空のリポジトリ**を返すこと。
 */
abstract class ${rootK}RepositoryContractTest {
	protected abstract fun repository(): ${rootK}Repository
	/** fixture の実体化(観測が一致する実装の Entity を返す)。 */
	protected abstract fun entity(fixture: ${k.fixtureName(td)}): ${k.name(td.lean)}
${if (ops.add) """
	@Test
	fun `add したものは findAll に保存順で並ぶ${if (ops.find) "、findById で引ける" else ""}`() {
		runBlocking {
			checkAll(PropTestConfig(seed = 42), $arbRepo) { fs ->
				val repo = repository()
				for (f in fs) repo.add(entity(f))
				assertEquals(fs, repo.findAll().map { it.toFixture() })${if (ops.find) """
				for (f in fs) assertEquals(f, repo.findById(f.$idField)?.toFixture())""" else ""}
			}
		}
	}
""" else ""}${if (ops.update && ops.add) """
	@Test
	fun `update は既存個体を書き換え、並びを保つ`() {
		runBlocking {
			checkAll(PropTestConfig(seed = 42), $arbRepo2) { fs ->
				val seeded = fs.dropLast(1)
				val at = seeded.size / 2
				val updated = fs.last().copy($idField = seeded[at].$idField)
				val repo = repository()
				for (f in seeded) repo.add(entity(f))
				repo.update(entity(updated))
				assertEquals(seeded.mapIndexed { j, f -> if (j == at) updated else f }, repo.findAll().map { it.toFixture() })
			}
		}
	}
""" else ""}${if (ops.find) """
	@Test
	fun `未知の id の findById は null`() {
		runBlocking {
			checkAll(PropTestConfig(seed = 42), ${k.arbCall(td.lean)}) { af ->
				assertNull(repository().findById(entity(af).$idField))
			}
		}
	}
""" else ""}}
""".trimIndent()
		}
	}
}
