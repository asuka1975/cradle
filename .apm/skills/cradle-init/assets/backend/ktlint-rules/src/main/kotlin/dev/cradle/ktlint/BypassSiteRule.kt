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
import org.jetbrains.kotlin.psi.KtImportDirective

/**
 * 性能バイパス(.claude/rules/backend-kotlin.md「性能バイパス」)の置き場の限定。
 *
 * 生成された Repository interface はドメイン契約の写しなので、性能のための一括操作は
 * 契約に足さず `*Bypass` interface として作る。その置き場は規約で決まっている:
 *
 * - **宣言は消費する UseCase のディレクトリ**。複数の UseCase から共有しない —
 *   共有した時点で、QueryService 規約が禁じたのと同じ結合が書き込み側に生まれる。
 * - **実装は infrastructure**。
 * - **`*Bypass` を import してよいのは実装側だけ**。消費する UseCaseImpl は宣言と
 *   同じパッケージに置くので import が要らない — import が現れた時点で共有の兆候である。
 *
 * 判定は `.editorconfig` の次のプロパティで調整する(いずれも配下のサブパッケージを含む):
 *
 * - `ktlint_cradle_bypass_site_declaration_package_prefix` 宣言を許すパッケージの接頭辞
 * - `ktlint_cradle_bypass_site_implementation_package_prefix` 実装と import を許すパッケージの接頭辞
 *
 * 例外を認めるときは宣言に `@Suppress("ktlint:cradle:bypass-site")` を付けて、理由をコメントに残す。
 */
class BypassSiteRule :
	Rule(
		ruleId = RuleId("${CradleRuleSetProvider.RULE_SET_ID.value}:bypass-site"),
		about = CradleRuleSetProvider.ABOUT,
		usesEditorConfigProperties = setOf(DECLARATION_PACKAGE_PREFIX_PROPERTY, IMPLEMENTATION_PACKAGE_PREFIX_PROPERTY),
	),
	RuleAutocorrectApproveHandler {

	private var declarationPackagePrefix = DECLARATION_PACKAGE_PREFIX_PROPERTY.defaultValue
	private var implementationPackagePrefix = IMPLEMENTATION_PACKAGE_PREFIX_PROPERTY.defaultValue

	override fun beforeFirstNode(editorConfig: EditorConfig) {
		declarationPackagePrefix = editorConfig[DECLARATION_PACKAGE_PREFIX_PROPERTY]
		implementationPackagePrefix = editorConfig[IMPLEMENTATION_PACKAGE_PREFIX_PROPERTY]
	}

	override fun beforeVisitChildNodes(
		node: ASTNode,
		emit: (offset: Int, errorMessage: String, canBeAutoCorrected: Boolean) -> AutocorrectDecision,
	) {
		when (node.elementType) {
			ElementType.IMPORT_DIRECTIVE -> visitImportDirective(node, emit)
			ElementType.CLASS, ElementType.OBJECT_DECLARATION -> visitClassOrObject(node, emit)
		}
	}

	private fun visitImportDirective(
		node: ASTNode,
		emit: (offset: Int, errorMessage: String, canBeAutoCorrected: Boolean) -> AutocorrectDecision,
	) {
		val directive = node.psi as? KtImportDirective ?: return
		val imported = directive.importedFqName ?: return
		if (!imported.shortName().asString().endsWith(BYPASS_SUFFIX)) return

		val packageName = directive.containingKtFile.packageFqName.asString()
		if (packageName.isUnderPackage(implementationPackagePrefix)) return

		emit(
			node.startOffset,
			"${imported.asString()} を import している。*$BYPASS_SUFFIX を import してよいのは" +
				"実装側($implementationPackagePrefix 配下)だけ — 消費する UseCaseImpl は宣言と同じパッケージに置くので" +
				" import は要らない(.claude/rules/backend-kotlin.md「性能バイパス」)",
			false,
		)
	}

	private fun visitClassOrObject(
		node: ASTNode,
		emit: (offset: Int, errorMessage: String, canBeAutoCorrected: Boolean) -> AutocorrectDecision,
	) {
		val declaration = node.psi as? KtClassOrObject ?: return
		val packageName = declaration.containingKtFile.packageFqName.asString()
		val offset = declaration.nameIdentifier?.textOffset ?: declaration.textOffset

		// interface *Bypass = バイパスの宣言。消費する UseCase のディレクトリにだけ置ける。
		if (declaration is KtClass && declaration.isInterface()) {
			if (declaration.name?.endsWith(BYPASS_SUFFIX) != true) return
			if (packageName.isUnderPackage(declarationPackagePrefix)) return
			emit(
				offset,
				"'${declaration.name}' の宣言が $packageName にある。" +
					"バイパスの宣言は消費する UseCase のディレクトリ($declarationPackagePrefix 配下)に置き、" +
					"複数の UseCase から共有しない(.claude/rules/backend-kotlin.md「性能バイパス」)",
				false,
			)
			return
		}

		// supertype に *Bypass を持つ class / object = バイパスの実装。infrastructure 側にだけ置ける。
		val bypassSupertype = declaration.superTypeNames().firstOrNull { it.endsWith(BYPASS_SUFFIX) } ?: return
		if (packageName.isUnderPackage(implementationPackagePrefix)) return
		emit(
			offset,
			"'${declaration.name ?: "(匿名)"}' は $bypassSupertype の実装だが $packageName にある。" +
				"バイパスの実装は $implementationPackagePrefix 配下に置く(.claude/rules/backend-kotlin.md「性能バイパス」)",
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

	companion object {
		private const val BYPASS_SUFFIX = "Bypass"

		val DECLARATION_PACKAGE_PREFIX_PROPERTY: EditorConfigProperty<String> =
			EditorConfigProperty(
				type =
				PropertyType.LowerCasingPropertyType(
					"ktlint_cradle_bypass_site_declaration_package_prefix",
					"*Bypass interface の宣言を許すパッケージの接頭辞(配下のサブパッケージも含む)",
					PropertyType.PropertyValueParser.IDENTITY_VALUE_PARSER,
				),
				defaultValue = "com.example.application.usecase",
			)

		val IMPLEMENTATION_PACKAGE_PREFIX_PROPERTY: EditorConfigProperty<String> =
			EditorConfigProperty(
				type =
				PropertyType.LowerCasingPropertyType(
					"ktlint_cradle_bypass_site_implementation_package_prefix",
					"*Bypass の実装と import を許すパッケージの接頭辞(配下のサブパッケージも含む)",
					PropertyType.PropertyValueParser.IDENTITY_VALUE_PARSER,
				),
				defaultValue = "com.example.infrastructure",
			)
	}
}
