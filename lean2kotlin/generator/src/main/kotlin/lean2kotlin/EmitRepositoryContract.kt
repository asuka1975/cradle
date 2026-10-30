package lean2kotlin

// ───────────────────────── Repository 契約テスト(規約由来 — Lean 由来ではない)

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
 * ${rootK}Repository の契約テスト(v1 規約: save は $idField による upsert)。
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
