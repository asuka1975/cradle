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
import org.jetbrains.kotlin.psi.KtFile

/**
 * トップレベルのクラス・interface・object は 1 ファイルに 1 つだけ。
 *
 * まとめ置きは grep でしか見つからない型を生み、ファイル名から中身が推測できなくなる。
 * 標準の `standard:filename` は「1 つだけのときに名前が一致するか」しか見ないので、
 * 複数まとめて置く書き方はこのルールで検出する。
 *
 * sealed 階層(sealed 型 + その直接のサブタイプ)は Kotlin の定石なので既定では許す。
 * `.editorconfig` の `ktlint_cradle_single_class_per_file_allow_sealed_subtypes = false`
 * で許さなくできる。個別に許すときは宣言に `@Suppress("ktlint:cradle:single-class-per-file")`。
 */
class SingleClassPerFileRule :
	Rule(
		ruleId = RuleId("${CradleRuleSetProvider.RULE_SET_ID.value}:single-class-per-file"),
		about = CradleRuleSetProvider.ABOUT,
		usesEditorConfigProperties = setOf(ALLOW_SEALED_SUBTYPES_PROPERTY),
	),
	RuleAutocorrectApproveHandler {

	private var allowSealedSubtypes = ALLOW_SEALED_SUBTYPES_PROPERTY.defaultValue

	/** Rule のインスタンスはファイルごとに作られる(RuleProvider の契約)ので 1 ファイル分で足りる。 */
	private var cachedReportables: List<KtClassOrObject>? = null

	override fun beforeFirstNode(editorConfig: EditorConfig) {
		allowSealedSubtypes = editorConfig[ALLOW_SEALED_SUBTYPES_PROPERTY]
	}

	override fun beforeVisitChildNodes(
		node: ASTNode,
		emit: (offset: Int, errorMessage: String, canBeAutoCorrected: Boolean) -> AutocorrectDecision,
	) {
		if (node.elementType != ElementType.CLASS && node.elementType != ElementType.OBJECT_DECLARATION) return
		val declaration = node.psi as? KtClassOrObject ?: return
		// 入れ子の型・companion object は対象外(トップレベルだけを数える)
		if (declaration.parent !is KtFile) return

		// 違反は宣言そのものを訪れたときに報告する。そうしないと、その宣言に付けた
		// @Suppress("ktlint:cradle:single-class-per-file") が効かない
		// (ktlint は訪問中のノードの位置で抑止を判定する)。
		val reported = reportableDeclarations(declaration.containingKtFile)
		if (reported.size <= 1 || reported.firstOrNull() == declaration || declaration !in reported) return

		val name = declaration.name ?: "(匿名)"
		val keep = reported.first().name ?: "(匿名)"
		emit(
			declaration.nameIdentifier?.textOffset ?: declaration.textOffset,
			"トップレベルの型が 1 ファイルに ${reported.size} 個ある。" +
				"'$name' は $name.kt に分ける(このファイルに残すのは '$keep' だけ)",
			false,
		)
	}

	/** 報告対象となるトップレベルの型(先頭の 1 つは「残す型」として報告しない)。 */
	private fun reportableDeclarations(file: KtFile): List<KtClassOrObject> = cachedReportables
		?: file
			.declarations
			.filterIsInstance<KtClassOrObject>()
			.let { declarations ->
				val sealedFamily = if (allowSealedSubtypes) sealedSubtypesIn(declarations) else emptySet()
				declarations.filterNot { it in sealedFamily }
			}.also { cachedReportables = it }

	/**
	 * 同じファイルで宣言された sealed 型を継承している宣言。sealed 側は「1 つ目の型」として残す。
	 */
	private fun sealedSubtypesIn(declarations: List<KtClassOrObject>): Set<KtClassOrObject> {
		val sealedNames =
			declarations
				.filterIsInstance<KtClass>()
				.filter { it.isSealed() }
				.mapNotNull { it.name }
				.toSet()
		if (sealedNames.isEmpty()) return emptySet()
		return declarations
			.filter { declaration -> declaration.superTypeNames().any { it in sealedNames } }
			.toSet()
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

	companion object {
		val ALLOW_SEALED_SUBTYPES_PROPERTY: EditorConfigProperty<Boolean> =
			EditorConfigProperty(
				type =
				PropertyType.LowerCasingPropertyType(
					"ktlint_cradle_single_class_per_file_allow_sealed_subtypes",
					"sealed 型とその直接のサブタイプを同じファイルに置くことを許すか",
					PropertyType.PropertyValueParser.BOOLEAN_VALUE_PARSER,
					"true",
					"false",
				),
				defaultValue = true,
			)
	}
}
