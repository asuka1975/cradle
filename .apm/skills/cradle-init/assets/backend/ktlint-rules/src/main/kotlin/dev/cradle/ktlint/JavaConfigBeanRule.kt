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
import org.jetbrains.kotlin.psi.KtBlockExpression
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtFile
import org.jetbrains.kotlin.psi.KtNameReferenceExpression
import org.jetbrains.kotlin.psi.KtNamedFunction
import org.jetbrains.kotlin.psi.KtReturnExpression

/**
 * Java Config(`@Configuration` + `@Bean`)による Bean 定義の検出。
 *
 * 自前の実装クラスを `new` するだけの `@Bean` メソッドは、そのクラスに `@Component`
 * (`@Service` / `@Repository` / `@Controller`)を付けてコンポーネントスキャンさせれば要らない。
 * Java Config に配線を溜めると、実装を足すたびに配線側も直す必要が生じ、依存が二重管理になる。
 *
 * 既定では「自前のクラスのコンストラクタを呼ぶだけ」の `@Bean` だけを検出する。
 * 判定は `.editorconfig` の次のプロパティで調整する:
 *
 * - `ktlint_cradle_java_config_bean_project_package_prefix`
 *   自前と見なすパッケージの接頭辞(既定は空 = すべて自前と見なす)。
 *   これにより第三者ライブラリの型を組み立てる `@Bean`(アノテーションを付けられない)は検出しない。
 * - `ktlint_cradle_java_config_bean_report_all = true`
 *   本体の形にかかわらず、すべての `@Bean` を検出する。
 *
 * どうしても Java Config でしか書けない Bean(第三者の型、ファクトリ経由、条件付き生成)は
 * `@Suppress("ktlint:cradle:java-config-bean")` を宣言に付けて、理由をコメントに残す。
 */
class JavaConfigBeanRule :
	Rule(
		ruleId = RuleId("${CradleRuleSetProvider.RULE_SET_ID.value}:java-config-bean"),
		about = CradleRuleSetProvider.ABOUT,
		usesEditorConfigProperties = setOf(PROJECT_PACKAGE_PREFIX_PROPERTY, REPORT_ALL_PROPERTY),
	),
	RuleAutocorrectApproveHandler {

	private var projectPackagePrefix = PROJECT_PACKAGE_PREFIX_PROPERTY.defaultValue
	private var reportAll = REPORT_ALL_PROPERTY.defaultValue

	override fun beforeFirstNode(editorConfig: EditorConfig) {
		projectPackagePrefix = editorConfig[PROJECT_PACKAGE_PREFIX_PROPERTY]
		reportAll = editorConfig[REPORT_ALL_PROPERTY]
	}

	override fun beforeVisitChildNodes(
		node: ASTNode,
		emit: (offset: Int, errorMessage: String, canBeAutoCorrected: Boolean) -> AutocorrectDecision,
	) {
		if (node.elementType != ElementType.FUN) return
		val function = node.psi as? KtNamedFunction ?: return
		if (!function.hasAnnotation(BEAN_ANNOTATION)) return

		val constructed = function.constructedProjectType()
		val offset = function.nameIdentifier?.textOffset ?: function.textOffset

		when {
			constructed != null ->
				emit(
					offset,
					"@Bean fun ${function.name}() は $constructed を組み立てるだけの配線。" +
						"$constructed に @Component(@Service / @Repository)を付けてコンポーネントスキャンさせる",
					false,
				)

			reportAll ->
				emit(
					offset,
					"@Bean fun ${function.name}() — Bean は @Component 系のアノテーションで宣言する。" +
						"Java Config でしか書けないなら @Suppress(\"ktlint:cradle:java-config-bean\") で理由を残す",
					false,
				)
		}
	}

	/**
	 * 本体が「自前のクラスのコンストラクタ呼び出し」だけなら、その型名。そうでなければ null。
	 *
	 * `= Foo(a, b)` と `{ return Foo(a, b) }` のどちらの形も見る。ファクトリ経由
	 * (`Foo.of(..)`)や組み立てを伴う本体は `@Component` では置き換えられないので対象外。
	 */
	private fun KtNamedFunction.constructedProjectType(): String? {
		val body =
			when (val expression = bodyExpression) {
				is KtBlockExpression ->
					(expression.statements.singleOrNull() as? KtReturnExpression)?.returnedExpression

				else -> expression
			}
		val call = body as? KtCallExpression ?: return null
		val callee = call.calleeExpression as? KtNameReferenceExpression ?: return null
		val name = callee.getReferencedName()
		// コンストラクタ呼び出しの近似。小文字始まりは関数呼び出しとみなす。
		if (name.firstOrNull()?.isUpperCase() != true) return null
		val qualifiedName = containingKtFile.qualifiedNameOf(name)
		return name.takeIf { qualifiedName.startsWith(projectPackagePrefix) }
	}

	/** import 宣言から解決する。import が無ければ同一パッケージの型とみなす。 */
	private fun KtFile.qualifiedNameOf(simpleName: String): String {
		val imported =
			importDirectives
				.firstOrNull { it.aliasName == simpleName || it.importedFqName?.shortName()?.asString() == simpleName }
				?.importedFqName
				?.asString()
		if (imported != null) return imported
		val packageName = packageFqName.asString()
		return if (packageName.isEmpty()) simpleName else "$packageName.$simpleName"
	}

	private fun KtNamedFunction.hasAnnotation(shortName: String): Boolean = annotationEntries.any { it.shortName?.asString() == shortName }

	companion object {
		private const val BEAN_ANNOTATION = "Bean"

		val PROJECT_PACKAGE_PREFIX_PROPERTY: EditorConfigProperty<String> =
			EditorConfigProperty(
				type =
				PropertyType.LowerCasingPropertyType(
					"ktlint_cradle_java_config_bean_project_package_prefix",
					"@Component を付けられる(= 自前の)クラスと見なすパッケージの接頭辞",
					PropertyType.PropertyValueParser.IDENTITY_VALUE_PARSER,
				),
				defaultValue = "",
			)

		val REPORT_ALL_PROPERTY: EditorConfigProperty<Boolean> =
			EditorConfigProperty(
				type =
				PropertyType.LowerCasingPropertyType(
					"ktlint_cradle_java_config_bean_report_all",
					"本体の形にかかわらず、すべての @Bean を検出するか",
					PropertyType.PropertyValueParser.BOOLEAN_VALUE_PARSER,
					"true",
					"false",
				),
				defaultValue = false,
			)
	}
}
