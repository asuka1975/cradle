package lean2kotlin

/**
 * 生成ファイル 1 枚の書き出し(EmitMain と EmitTests で共有)。本文が参照した型・fixture・Arb を集め、
 * 役割別パッケージへのインポートを計算して target に書く。
 * インポートは emitter の主の Output の basePackage から組む — 書き出す Output はすべて同じ basePackage を持つ。
 */
internal class GeneratedFiles(
	private val ir: Ir,
	private val k: Kotlinize,
	private val basePackage: String,
) {

	fun emit(
		target: Output, subpkg: String?, name: String,
		framework: List<String> = emptyList(),
		usesDomainResult: Boolean = false,
		build: () -> String,
	) {
		val (body, c) = k.collecting(build)
		val imports = mutableListOf<String>()
		imports.addAll(framework)
		if ((usesDomainResult || DOMAIN_RESULT_REF.containsMatchIn(body)) && subpkg != null) imports.add("$basePackage.DomainResult")
		for (lean in c.refs) {
			val td = ir.typeDef(lean)
			val refPkg = k.packagePathOf(td)
			if (refPkg != subpkg) {
				imports.add(basePackage + (refPkg?.let { ".$it" } ?: "") + "." + td.kotlin)
			}
		}
		for (lean in c.fixtures) {
			// fixture はテストのルートパッケージ(GeneratedFixtures)在住
			if (subpkg != null) {
				imports.add(basePackage + "." + ir.typeDef(lean).kotlin + "Fixture")
			}
		}
		if (subpkg != null && body.contains(".toFixture(")) {
			imports.add("$basePackage.toFixture")
		}
		if (subpkg != null && RATIONAL_REF.containsMatchIn(body)) imports.add("$basePackage.Rational")
		if (subpkg != null) {
			for (kn in c.arbs) imports.add("$basePackage.${k.arbFunName(kn)}")
		}
		target.file(subpkg, name, imports, body)
	}
}
