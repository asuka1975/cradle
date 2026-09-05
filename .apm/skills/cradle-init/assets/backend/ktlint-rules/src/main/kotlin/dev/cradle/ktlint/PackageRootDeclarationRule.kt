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
import org.jetbrains.kotlin.psi.KtFile
import org.jetbrains.kotlin.psi.KtNamedDeclaration

/**
 * 層のパッケージ直下にトップレベル宣言を置かせない。
 *
 * `.claude/rules/backend-kotlin.md` が定義しているのは `application/usecase/<名前>/` などの
 * **サブディレクトリ**だけで、`application/` 直下は規約の空白地帯だった。
 * 未定義の場所はどの規約にも違反しないので、どこにも属さない共有ヘルパが溜まる
 * (共有ヘルパの置き場になりやすい)。置き場が決まらないものは、
 * だいたい責務も決まっていない。
 *
 * 検出するのはクラス・interface・object・トップレベル関数・トップレベルプロパティ・typealias。
 * 対象のパッケージは `.editorconfig` の
 * `ktlint_cradle_package_root_declaration_packages`(カンマ区切り)で指定する。
 * 判定は**完全一致**なので、`com.example.application` を指定しても
 * `com.example.application.usecase.save` は対象外。
 *
 * 例外を認めるときは宣言に `@Suppress("ktlint:cradle:package-root-declaration")` を付けて、
 * 理由をコメントに残す。
 */
class PackageRootDeclarationRule :
	Rule(
		ruleId = RuleId("${CradleRuleSetProvider.RULE_SET_ID.value}:package-root-declaration"),
		about = CradleRuleSetProvider.ABOUT,
		usesEditorConfigProperties = setOf(PACKAGES_PROPERTY),
	),
	RuleAutocorrectApproveHandler {

	private var packages = PACKAGES_PROPERTY.defaultValue.toNameList()

	override fun beforeFirstNode(editorConfig: EditorConfig) {
		packages = editorConfig[PACKAGES_PROPERTY].toNameList()
	}

	override fun beforeVisitChildNodes(
		node: ASTNode,
		emit: (offset: Int, errorMessage: String, canBeAutoCorrected: Boolean) -> AutocorrectDecision,
	) {
		if (node.elementType !in DECLARATION_TYPES) return
		val declaration = node.psi as? KtNamedDeclaration ?: return
		// 入れ子の宣言は対象外(トップレベルだけを見る)
		if (declaration.parent !is KtFile) return

		val packageName = declaration.containingKtFile.packageFqName.asString()
		if (packageName !in packages) return

		val name = declaration.name ?: "(匿名)"
		emit(
			declaration.nameIdentifier?.textOffset ?: declaration.textOffset,
			"'$name' が $packageName 直下にある。ここは .claude/rules/backend-kotlin.md が定義していない置き場で、" +
				"どの層にも属さない共有ヘルパの溜まり場になる。使う側の usecase/<ユースケース名>/ か、" +
				"層をまたぐものなら infrastructure/ など役割の決まった場所へ移す",
			false,
		)
	}

	private fun String.toNameList(): List<String> = split(',').map { it.trim() }.filter { it.isNotEmpty() }

	companion object {
		private val DECLARATION_TYPES =
			setOf(
				ElementType.CLASS,
				ElementType.OBJECT_DECLARATION,
				ElementType.FUN,
				ElementType.PROPERTY,
				ElementType.TYPEALIAS,
			)

		val PACKAGES_PROPERTY: EditorConfigProperty<String> =
			EditorConfigProperty(
				type =
				PropertyType.LowerCasingPropertyType(
					"ktlint_cradle_package_root_declaration_packages",
					"トップレベル宣言を置かせないパッケージ(カンマ区切り。完全一致)",
					PropertyType.PropertyValueParser.IDENTITY_VALUE_PARSER,
				),
				defaultValue = "",
			)
	}
}
