package dev.cradle.ktlint

import com.pinterest.ktlint.rule.engine.core.api.AutocorrectDecision
import com.pinterest.ktlint.rule.engine.core.api.ElementType
import com.pinterest.ktlint.rule.engine.core.api.Rule
import com.pinterest.ktlint.rule.engine.core.api.RuleAutocorrectApproveHandler
import com.pinterest.ktlint.rule.engine.core.api.RuleId
import com.pinterest.ktlint.rule.engine.core.api.editorconfig.EditorConfig
import com.pinterest.ktlint.rule.engine.core.api.editorconfig.EditorConfigProperty
import org.ec4j.core.model.PropertyType
import org.jetbrains.kotlin.com.intellij.lang.ASTNode
import org.jetbrains.kotlin.psi.KtClass
import org.jetbrains.kotlin.psi.KtClassOrObject

/**
 * Repository を実装するクラスの置き場の限定(backend-kotlin 規則の機械化)。
 *
 * 契約テストは本番の実装を実 DB 相手にそのまま使う。テスト専用の `InMemorySomeRepository` の
 * ようなフェイクを挟むと、そのテストは本番のコードを一切通らなくなり、リポジトリの実装に
 * 紛れ込んだバグ(SQL の誤り・更新し忘れた列)を検出できない。
 *
 * そこで「supertype の参照名が `Repository` で終わるクラス・object の宣言」を、許可パッケージ
 * (本番実装の置き場 = infrastructure)の外で報告する。`.editorconfig` はテストソース
 * (`[src/test/**/*.kt]`)で許可を空に戻すので、テストではどこにも置けない
 * (object 式で作ったフェイクも同様に検出する)。interface の拡張は実装ではないので見ない。
 *
 * - `ktlint_cradle_no_repository_fake_allowed_packages`
 *   Repository の実装を置いてよいパッケージ(カンマ区切り。配下のサブパッケージも含む)
 */
class NoRepositoryFakeRule :
	Rule(
		ruleId = RuleId("${CradleRuleSetProvider.RULE_SET_ID.value}:no-repository-fake"),
		about = CradleRuleSetProvider.ABOUT,
		usesEditorConfigProperties = setOf(ALLOWED_PACKAGES_PROPERTY),
	),
	RuleAutocorrectApproveHandler {

	private var allowedPackages = ALLOWED_PACKAGES_PROPERTY.defaultValue.toNameList()

	override fun beforeFirstNode(editorConfig: EditorConfig) {
		allowedPackages = editorConfig[ALLOWED_PACKAGES_PROPERTY].toNameList()
	}

	override fun beforeVisitChildNodes(
		node: ASTNode,
		emit: (offset: Int, errorMessage: String, canBeAutoCorrected: Boolean) -> AutocorrectDecision,
	) {
		if (node.elementType != ElementType.CLASS && node.elementType != ElementType.OBJECT_DECLARATION) return
		val declaration = node.psi as? KtClassOrObject ?: return
		// interface の拡張(interface Foo : BarRepository)は実装ではない
		if (declaration is KtClass && declaration.isInterface()) return
		val supertype = declaration.superTypeNames().firstOrNull { it.endsWith(REPOSITORY_SUFFIX) } ?: return

		val packageName = declaration.containingKtFile.packageFqName.asString()
		if (allowedPackages.any { packageName.isUnderPackage(it) }) return

		val name = declaration.name ?: "(匿名)"
		val where =
			if (allowedPackages.isEmpty()) {
				"このソースセットに Repository の実装を置いてよい場所はない"
			} else {
				"Repository の実装を置いてよいのは ${allowedPackages.joinToString("・")} だけ"
			}
		emit(
			declaration.nameIdentifier?.textOffset ?: declaration.textOffset,
			"'$name' が $supertype を実装している。$where。" +
				"テストダミー(InMemory 実装)は本番コードを一切通らないテストを作る — 本番実装を実 DB 相手にそのまま使う(backend-kotlin 規則)",
			false,
		)
	}

	/** `: Foo()` `: Foo` `: Foo<Bar>` のいずれからも `Foo` を取り出す。 */
	private fun KtClassOrObject.superTypeNames(): List<String> = superTypeListEntries.mapNotNull { entry ->
		entry
			.typeReference
			?.typeElement
			?.text
			?.substringBefore('<')
			?.substringAfterLast('.')
			?.trim()
	}

	/** `com.example.infra` は `com.example.infra` と `com.example.infra.jooq` に一致し、`com.example.infraX` には一致しない。 */
	private fun String.isUnderPackage(prefix: String): Boolean = this == prefix || startsWith("$prefix.")

	private fun String.toNameList(): List<String> = split(',').map { it.trim() }.filter { it.isNotEmpty() }

	companion object {
		private const val REPOSITORY_SUFFIX = "Repository"

		val ALLOWED_PACKAGES_PROPERTY: EditorConfigProperty<String> =
			EditorConfigProperty(
				type =
				PropertyType.LowerCasingPropertyType(
					"ktlint_cradle_no_repository_fake_allowed_packages",
					"Repository の実装を置いてよいパッケージ(カンマ区切り。配下のサブパッケージも含む)",
					PropertyType.PropertyValueParser.IDENTITY_VALUE_PARSER,
				),
				defaultValue = "",
			)
	}
}
