# MonoWa の改善ポイント

> Cradle を作るにあたり monowa を監査した結果。High / Medium は独立の検証エージェントが反証を試みて残ったもの、Low は未検証。
> 規約ではない。ここに挙げたものを Cradle の規約（`.claude/rules/`）と道具（hook・lint）が再発防止として持つ。パスは monowa リポジトリ基準（`monowa/` = そのルート）。

件数: 102（High 21 / Medium 45 / Low 36）

## High（先に直すべきもの）

1. **JWKS 取得の失敗 (IdP/NAT 障害) が 401 `unauthenticated` に化け、タイムアウト/キャッシュ/障害耐性がライブラリ既定任せ** — `monowa/backend/src/main/kotlin/com/monowa/config/SecurityConfig.kt:46`（バックエンド設計（認証・認可・外部連携・ログ・設定））
2. **構造化ログ・相関 ID・コマンド監査ログが存在しない (ログ文は 1 つだけ)** — `monowa/backend/src/main/kotlin/com/monowa/presentation/error/GlobalExceptionHandler.kt:61`（バックエンド設計（認証・認可・外部連携・ログ・設定））
3. **「二重には貸さない」の直列化点が無い — 同一表明への同時 raiseHand / passTurn が両方成立する** — `monowa/backend/src/main/kotlin/com/monowa/application/usecase/raisehandusecase/RaiseHandUseCaseImpl.kt:68`（バックエンド実装（UseCase・永続化・テスト））
4. **@[contract] 定理が golden 0 件になっても黙って通る — ConfirmReturn の成功経路・RaiseHand の即成立経路に backend テストが存在しない** — `monowa/backend/src/generated/kotlin-test/application/usecase/confirmreturnusecase/ConfirmReturnUseCaseContractTest.kt:59`（バックエンド実装（UseCase・永続化・テスト））
5. **集約の update が version 列も行ロックも無い全列上書き — 失われた更新が起きる** — `monowa/backend/src/main/kotlin/com/monowa/infrastructure/LoanRepositoryImpl.kt:123`（バックエンド実装（UseCase・永続化・テスト））
6. **OIDC の authorize/token エンドポイントを `${issuer}/authorize` `${issuer}/token` に決め打ち — 本番 Cognito では成立しない** — `monowa/frontend/src/auth/session.ts:132`（フロントエンド）
7. **期限切れ・無効トークン（401 unauthenticated / 403 noActor）の扱いが無く「板が見つかりません」の行き止まりになる** — `monowa/frontend/src/state/boards.ts:88`（フロントエンド）
8. **README / CLAUDE.md がコードと乖離（6 画面・`#/mine/*`・`lib/mine.ts`・`ScopeNote.tsx`・「板 3 本」）** — `monowa/frontend/README.md:117`（フロントエンド）
9. **空 DB への同時起動でスキーマ初期化が競合する（INFRA-Q-007 未決のまま本番前提が desired_count=2）** — `monowa/backend/src/main/resources/application.yml:12`（インフラ・E2E）
10. **既定の apply で CloudFront→ALB が平文になり、Authorization ヘッダ（ID トークン）がその区間で裸になる（fail-open な既定値）** — `monowa/infra/envs/prod/variables.tf:95`（インフラ・E2E）
11. **CI/CD が存在せず、本番イメージが開発者端末でリポジトリ外の依存を使って焼かれる（再現性・供給網）** — `monowa/documents/infra-design/04_operations.md:35`（インフラ・E2E）
12. **e2e が「順番待ちからの自動番回し（nextInLine / TurnPassing）」を一度も辿っていない** — `monowa/e2e/src/model/flows.ts:106`（インフラ・E2E）
13. **lean-domain-model スキルが別プロダクト（Album/Media/Author）の層構成・パスを丸ごと記述している** — `monowa/.claude/skills/lean-domain-model/SKILL.md:148`（slop・drift（散文と規約））
14. **lean-conventions.md が日付付き裁定・外部文書番号・別ドメイン例で 737 行に膨らんでいる** — `monowa/.claude/skills/lean-domain-model/references/lean-conventions.md:29`（slop・drift（散文と規約））
15. **scaffold に別プロダクト名 Akashic.lean と存在しないモジュール群が同梱されている** — `monowa/.claude/skills/lean-domain-model/assets/scaffold/Akashic.lean:15`（slop・drift（散文と規約））
16. **domain-mockup スキルが写真アルバム UI の規約・チェックリストのまま、CLI コマンド数も正本と食い違う** — `monowa/.claude/skills/domain-mockup/SKILL.md:57`（slop・drift（散文と規約））
17. **「ID をコードに書かない」規約と「全定理に ID を付ける」スキルが正面衝突し、コードには 110 か所残る（規約は「残存 0」と主張）** — `monowa/documents/codestyle/08_comments.md:31`（slop・drift（散文と規約））
18. **CLAUDE.md「DB は H2 のインメモリが既定」が application.yml の既定（local = PostgreSQL）と矛盾** — `monowa/CLAUDE.md:152`（slop・drift（散文と規約））
19. **CLAUDE.md と frontend/README.md が存在しない 6 画面（#/mine/*）・lib/mine.ts・ScopeNote.tsx を規約として記述（既知のまま放置）** — `monowa/CLAUDE.md:234`（slop・drift（散文と規約））
20. **infra/README.md に「認証を入れる前の姿」と注記した旧手順が丸ごと残り、同文書の他節と矛盾** — `monowa/infra/README.md:95`（slop・drift（散文と規約））
21. **インフラ設計の正本に日付付き進捗チェックリスト（✅⏳）が残り、⏳ 項目が今は偽** — `monowa/documents/infra-design/02_local.md:271`（slop・drift（散文と規約））

## バックエンド設計（認証・認可・外部連携・ログ・設定）

### [High] JWKS 取得の失敗 (IdP/NAT 障害) が 401 `unauthenticated` に化け、タイムアウト/キャッシュ/障害耐性がライブラリ既定任せ

- 場所: `monowa/backend/src/main/kotlin/com/monowa/config/SecurityConfig.kt:46`（external-service）
- 根拠: SecurityConfig.kt:46 `val decoder = NimbusJwtDecoder.withJwkSetUri(properties.jwkSetUri).build()` — `.restOperations(...)` / `.cache(...)` / `jwtProcessorCustomizer` の指定なし。解決済み spring-security-oauth2-jose 7.1.0 のソース: `private RestOperations restOperations = new RestTemplateWithNimbusDefaultTimeouts();` (NimbusJwtDecoder.java:302) → `RemoteJWKSet.DEFAULT_HTTP_CONNECT_TIMEOUT = 500` / `DEFAULT_HTTP_READ_TIMEOUT = 500` …
- なぜ問題か: Cognito 到達不能・NAT 障害・500ms 超の応答遅延 (NAT 経由の JWKS 取得で十分起こりうる) が、クライアントには「サインインが必要」と同じ応答になる。画面は再サインインループに入り、運用側は 5xx アラームが鳴らないため IdP 障害に気づけない。アプリ側のログは BearerTokenAuthenticationFilter.java:211 の `logger.trace` だけで、Tomcat の SEVERE スタックトレースにリクエスト/名義の文脈が無い。5 分ごとの再取得で毎回この窓が開く。
- 直し方: (1) `.restOperations(...)` に connect/read タイムアウトを明示した RestClient/RestTemplate を渡し (例: 2s/3s)、Spring `Cache` を `.cache(...)` に渡すか `jwtProcessorCustomizer` で Nimbus の `outageTolerant`/`refreshAheadCache` を有効化する。(2) `oauth2ResourceServer { it.authenticationEntryPoint(...) }` に加えて `BearerTokenAuthenticationFilter` の失敗ハンドラを差し替え、`AuthenticationServiceException` を 503 `idpUnavailable` (openapi.yaml の ErrorCode に追加) として error ログ付きで返す。(3) 起動時に JWKS を warm-up し、ヘルスチェックか readiness に IdP 到達性を含めるか検討する。(4) 監視に 401 急増アラームを足す。
- Cradle の規則: 外部サービス (IdP/JWKS・DB・メール等) の到達不能は「クライアントの認証失敗 (401)」と別のコード (503 系)・別のログレベル (error)・別のアラームに必ず分ける。HTTP クライアントのタイムアウト・キャッシュ TTL・再試行・障害耐性はライブラリ既定に任せず、設定値を明示して KDoc/設計書に根拠を書く。

### [High] 構造化ログ・相関 ID・コマンド監査ログが存在しない (ログ文は 1 つだけ)

- 場所: `monowa/backend/src/main/kotlin/com/monowa/presentation/error/GlobalExceptionHandler.kt:61`（logging）
- 根拠: backend/src 全体で LoggerFactory の利用は `private val log = LoggerFactory.getLogger(GlobalExceptionHandler::class.java)` (GlobalExceptionHandler.kt:21) と `log.error("unhandled exception", ex)` (:61) のみ (grep `LoggerFactory|getLogger|println|MDC|slf4j|KotlinLogging` で他に hit なし)。`src/main/resources` は `application*.yml` と `db/` だけで logback/JSON エンコーダ設定なし、build.gradle.kts にも logstash-encoder 等なし。CloudWatch へは `logDriver = "aw…
- なぜ問題か: 「誰が・いつ・どのコマンドを・どの結果で」実行したかを運用上まったく再構成できない。`deactivateAccount` は「渡ったあとは抜けられない」の唯一の例外として進行中の一件を流す (DeactivateAccountUseCaseImpl.kt:23-29) 大きな波及を持つが、誤操作・不正操作の追跡手段が無い。[MQ-024]「担当が誰かは業務上残さない」は業務記録 (ドメイン) の決定であり、運用の監査ログを持たない理由にはならない。相関 ID が無いので 2 タスク構成 (03_aws-production.md:11-12) で 1 リクエストのログを ALB アクセスログと突き合わせられない。
- 直し方: (1) logback-spring.xml で JSON (logstash encoder or Boot 3.4+ の `logging.structured.format.console=ecs`) を prod プロファイルで有効化。(2) `OncePerRequestFilter` で `X-Request-Id` (無ければ生成) と、認証後は `actor.employeeId` / `steward=true` を MDC に載せる。(3) コマンド UseCase の `execute` を横断する薄い監査ロガー (AOP か `@ActorScoped` Bean のデコレータ) で `operation` / `target id` / `result code` / `elapsed` を info で 1 行出す — 本文・トークン・クレーム全体は載せない。(4) `handleUnexpected` のログにも requestId を含める。
- Cradle の規則: コマンド系 UseCase は「requestId・actor 識別子・operation・対象 ID・結果 (Ok/Err code)・所要時間」を構造化ログ (JSON) に必ず 1 行残す。相関 ID は入口フィルタで採番し MDC 経由で全ログに付与する。ドメインが「誰がしたかを記録しない」と決めても、運用監査ログは別に持つ (ドメイン記録とオペレーション監査を混同しない)。

### [Medium] `spring.profiles.default: local` — プロファイル無指定で開発設定に黙って倒れ、規約「安全に失敗する」と乖離

- 場所: `monowa/backend/src/main/resources/application.yml:9`（config）
- 根拠: application.yml:8-9 `profiles:\n    default: local`。application-local.yml:25-27 `issuer: http://localhost:8090/monowa / jwk-set-uri: http://localhost:8090/monowa/jwks / audience: monowa-web`、:7-9 `url: jdbc:postgresql://localhost:5432/monowa / username: monowa / password: monowa`。規約 05_configuration.md:32-33「`application.yml`(共通)は、プロファイル無指定で起動したとき**安全に失敗する**構成にする。datasource を持たないまま起動が成功し…形を作らない」。本番は infra/modules/bac…
- なぜ問題か: 本番イメージが `SPRING_PROFILES_ACTIVE` 無しで起動した場合 (タスク定義の退行・ローカルでの本番 jar 検証など)、平文 http の localhost 発行者と平文 DB パスワードが既定になる。今日は local の DB URL が localhost なので `spring.sql.init.mode: always` の DDL 実行で起動が落ちる (=偶然 fail-closed) が、application.yml 自身に歯止めが無く、local の datasource が環境変数で上書きされる構成 (infra/envs/local/main.tf:247-249) では「本番 DB + モック発行者」の組合せも理屈上は作れる。規約と実装が食い違っている点も drift。
- 直し方: `profiles.default` を外し、`./gradlew bootRun` の利便は build.gradle.kts の `tasks.named<BootRun>("bootRun") { systemProperty("spring.profiles.active", "local") }` で与える (規約の意図どおり application.yml 単体では datasource/auth が無く起動失敗)。加えて `ApplicationListener<ApplicationEnvironmentPreparedEvent>` で「`prod` 以外のプロファイルで `MONOWA_AUTH_ISSUER` が `http://` なら起動失敗」のような防御を置く。05_configuration.md を更新するか実装を戻すか、どちらかに揃える。
- Cradle の規則: 配布物 (jar/イメージ) はプロファイル無指定で必ず起動失敗させる。開発時の既定プロファイルは起動コマンド (Gradle タスク・docker compose) 側で与え、`spring.profiles.default` や共通 yml に開発向け接続先・発行者・パスワードを置かない。規約と yml の乖離は lint (yml のキー禁止リスト) で検査する。

### [Medium] セキュリティフィルタチェーン (401/403) とエラー契約の全経路が HTTP レベルでテストされていない

- 場所: `monowa/backend/src/test/kotlin/com/monowa/presentation/auth/ActorContextFactoryTest.kt:70`（testing）
- 根拠: ActorContextFactoryTest.kt:70 `SecurityContextHolder.getContext().authentication = JwtAuthenticationToken(jwt)` — フィルタチェーンを通さず直接差し込む。`grep -rl "MockMvc|WebMvcTest|jwt\(\)|SecurityConfig|GlobalExceptionHandler|MonoWaAccessDeniedHandler|UnauthenticatedEntryPoint" backend/src/test e2e` の hit は `backend/src/test/resources/application-test.yml` のコメント行のみ。build.gradle.kts:44 `testImplementation("org.springframework.security…
- なぜ問題か: `requestMatchers("/api/steward/**").hasAuthority(STEWARD)` の順序 (SecurityConfig.kt:95-99)、`MonoWaAccessDeniedHandler.classify` の分岐 (:45-51)、405/415/ルート不一致 404 の `{code,message}` 化 (GlobalExceptionHandler.kt:28-40)、Bean Validation の 400 化はいずれも回帰試験が無い。生成契約テストは「与えられた名義の下のふるまい」しか守らない (ActorContext.kt:24-26 の KDoc が明言) ので、境界の正しさは手書きテストでしか担保できない。
- 直し方: `@SpringBootTest` + `MockMvc` + `SecurityMockMvcRequestPostProcessors.jwt()` で、(a) トークン無し→401 `unauthenticated`、(b) employeeId 無し→403 `noActor`、(c) 社員トークンで `/api/steward/**`→403 `stewardOnly`、(d) 担当印+非会員→404 `unknownEmployee`、(e) 405/415/未知パス/`@NotBlank` 違反→契約どおりの body、(f) 未捕捉例外→500 `internalError` の各ケースをエンドポイント×名義のマトリクスで持つ。
- Cradle の規則: 認可の門 (フィルタチェーン) とエラー契約の「全経路」は、UseCase の契約テストとは別に HTTP レベルの境界テスト (MockMvc + jwt()) を必ず持つ。テストマトリクスは「エンドポイント × 名義の種別 (無し/不完全/社員/管理者) × 期待 status/code」で表にし、openapi.yaml の responses と突き合わせる。

### [Medium] 文字列入力に maxLength が無く、DB 列幅超過が 500 `internalError` になる

- 場所: `monowa/documents/codebase/openapi.yaml:1471`（validation）
- 根拠: openapi.yaml:1469-1473 `itemLabel: type: string / minLength: 1 / x-field-extra-annotation: '@field:jakarta.validation.constraints.NotBlank'`、同様に `text` (:1482-1484)、`method` (:1496-1498)、`handoverMethod` (:1512-1514) — いずれも `maxLength` なし (grep `maxLength` は 0 件)。一方 schema.sql:28 `item_label VARCHAR(255) NOT NULL`、:58 `handover_method VARCHAR(255)`、:60 `return_method VARCHAR(255)`、:84 `body VARCHAR(2000) NOT NULL`。超過…
- なぜ問題か: 256 文字の `itemLabel` や 2001 文字の一言を送るだけで 500 が返り、07_presentation.md:40「構築の失敗はすべて 400 badRequest」の契約から外れる。`alb-target-5xx` アラームがクライアント入力で鳴らせる (簡易 DoS/ノイズ)。また DB 例外のスタックトレースが error ログに載り続ける。
- 直し方: openapi.yaml の各文字列入力に `maxLength` (255 / 2000) を足し、生成 DTO の `@Size(max=…)` に乗せる。OpenAPI の maxLength と schema.sql の列幅の整合を CI で検査する (DDL をパースして比較する小テスト、または列幅を単一の定数表から両方へ生成)。
- Cradle の規則: 境界で受ける文字列は必ず上限長を持ち、永続化列幅と同じ値を単一の正本から導く (OpenAPI ↔ DDL の整合をテストで固定する)。入力起因の失敗が 500 に到達する経路を残さない。

### [Medium] 認証アダプタが業務トランザクション外で集約全体を read-modify-write し、無効化を取り消す lost update の窓がある

- 場所: `monowa/backend/src/main/kotlin/com/monowa/presentation/auth/ActorContextFactory.kt:96`（transaction）
- 根拠: ActorContextFactory.kt:90-97 `val employee = employeeRepository.findById(employeeId)?.takeIf { it.isMember() } ?: return null … val reflected = employee.reflectDepartment(department) / employeeRepository.update(reflected)`; EmployeeRepositoryImpl.kt:46-53 `update` は `DEPARTMENT_ID` / `STANDING` / `ACTIVE` を全部書き戻す。KDoc :79-81「この書き込みは呼び出し元の業務トランザクションの外で確定する」。ai-notes/20260901-01-actor-context-department-write-tradeoffs…
- なぜ問題か: 認可上の重要状態 (`active` / `standing`) が、認証アダプタという認可判断より前の場所から、業務トランザクションと無関係に上書きされうる。無効化された社員の並行リクエストが無効化を取り消す (アカウント無効化 = アクセス剥奪が競合で失われる) のは頻度が低くても結果が一方的で、監査ログ (finding 2) も無いため発生に気づけない。また `employee()` は `open()` の戻り値を捨てるため (:42)、非会員でも `ActorContext` が作られ各 UseCase が再度 `findById` する二重読みになっている (PostIntentUseCaseImpl.kt:30-31)。
- 直し方: 所属の写し直しを `UPDATE employee SET department_id=? WHERE id=? AND active AND department_id<>?` の条件付き単列 UPDATE (性能バイパスとして `presentation/auth` に置けるよう 06_lint.md `bypass-site` の許可パッケージを広げる) にし、`standing`/`active` を巻き込まない。あるいは `Employee` にバージョン列を足して楽観ロックにする。長期的には名義解決 (読み取り) と所属反映 (副作用) を分け、副作用は UseCase のトランザクション境界内で行う。
- Cradle の規則: 認証アダプタ (名義解決) は読み取り専用にする。名義に付随する副作用 (最終ログイン・所属反映など) が必要なら、業務トランザクション内で対象列だけを条件付き UPDATE で書き、認可に効く列 (有効/立場/権限) を巻き込む集約全体の書き戻しをしない。

### [Low] Bean Validation の 400 応答にフィールド名とフレームワーク既定メッセージを写している

- 場所: `monowa/backend/src/main/kotlin/com/monowa/presentation/error/GlobalExceptionHandler.kt:50`（error-handling）
- 根拠: GlobalExceptionHandler.kt:48-52 `val message = ex.bindingResult.fieldErrors.joinToString("; ") { fe -> "${fe.field}: ${fe.defaultMessage ?: "invalid"}" }.ifEmpty { "invalid request" }`、:39 `ErrorResponse(code, status.reasonPhrase)`。規約 07_presentation.md:64-65「**例外メッセージを応答本文に写さない**（内部実装・JSON パス等の露出）。message は自前の文言にする」。
- なぜ問題か: `defaultMessage` は Hibernate Validator の既定文言 ("must not be blank" 等、ロケール依存の英語) で、他の応答が日本語の自前文言 (DomainErrorMapping.kt:24-55) なのと不揃い。ネストしたフィールドは `terms.returnPromise.method` のように内部の JSON パスがそのまま出る。露出の実害は軽微だが規約との drift。
- 直し方: `fe.field` は出さずコード側で自前の文言 (例「必須項目が空です」) に置き換えるか、フィールド→文言の対応表を presentation/error に持つ。`handleExceptionInternal` の `status.reasonPhrase` も自前文言に置き換える。
- Cradle の規則: 境界のエラー message はフレームワーク/ライブラリ既定文言・例外メッセージ・内部パスを写さず、presentation が持つ文言テーブルから引く (ロケール・語調を全経路で揃える)。

### [Low] CloudFront→ALB 区間が平文になりうる構成が残り、`/api/*` 経路にセキュリティヘッダポリシーも無い

- 場所: `monowa/infra/modules/frontend-delivery/main.tf:158`（infra）
- 根拠: frontend-delivery/main.tf:149 default_cache_behavior に `response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id` があるが、`/api/*` の ordered_cache_behavior (:154-162) には `response_headers_policy_id` が無い。:122-126 `origin_protocol_policy = var.alb_origin_protocol_policy / http_port = … == "http-only" ? …`。03_aws-production.md:247-251「`aliases` と証明書が空だと CloudFront 既定ドメインで配信し、CloudFront →…
- なぜ問題か: Bearer トークンが AWS バックボーン内とはいえ平文区間を通る。既知・文書化済みで社内利用前提だが、「未検証 — AWS への apply はまだ行っていない」(03_aws-production.md:242) のまま独自ドメイン決定 (INFRA-Q-004) を待つ状態。API 応答にセキュリティヘッダが無いのは JSON API では実害が小さいが、SPA 経路と扱いが揃っていない。
- 直し方: 本番運用前に ACM 証明書 + `https-only` を必須条件にし (Terraform の `variable validation` で prod は `https-only` 以外を拒否)、backend に `server.forward-headers-strategy=framework` を設定して `X-Forwarded-Proto` を尊重する。`/api/*` にも `Managed-SecurityHeadersPolicy` を付ける。
- Cradle の規則: Bearer トークンを運ぶ全区間を TLS にし、prod の IaC は平文オリジンを変数検証で拒否する。リバースプロキシ背後のアプリは forward-headers の扱いを明示し、セキュリティヘッダは静的配信経路と API 経路の両方に付ける。

### [Low] `AuthProperties` に妥当性検証が無く、空文字や平文 http の発行者をそのまま受け入れる

- 場所: `monowa/backend/src/main/kotlin/com/monowa/config/AuthProperties.kt:17`（config）
- 根拠: AuthProperties.kt:16-23 `@ConfigurationProperties(prefix = "monowa.auth") data class AuthProperties(val issuer: String, val jwkSetUri: String, val audience: String)` — `@Validated` / `@NotBlank` / URL 形式の検査なし。SecurityConfig.kt:51 `aud.contains(properties.audience)`、:50 `JwtIssuerValidator(properties.issuer)`。
- なぜ問題か: 未設定は起動失敗 (fail-closed) だが、`MONOWA_AUTH_AUDIENCE=""` のような空値・末尾スラッシュ違い・`http://` の発行者は起動を通り、症状は「全リクエスト 401」として現れる (finding 1 と同じく IdP 障害と区別がつかない)。local の `http://localhost:8090/monowa` を prod でも受け入れる。
- 直し方: `@Validated` + `@field:NotBlank`、`issuer`/`jwkSetUri` に `@field:Pattern("^https?://.+")`、prod プロファイルでは `https` を要求する `ApplicationRunner`/`SmartInitializingSingleton` の検査を足し、起動ログに issuer/audience (秘密ではない) を info で出す。
- Cradle の規則: 認証・外部接続の設定プロパティは起動時に形式検証し、本番プロファイルでは https 等の安全側を強制する (開発の緩和は明示のオプトイン)。設定値の欠落・不正は「起動失敗 + 原因が分かるログ」で現れるようにし、実行時の全件失敗として現れさせない。

### [Low] 「呼び出し本人が主体になれない」状態が経路によって 404 `unknownEmployee` / 404 `notMember` / 403 `noActor` に割れ、message も宛先向けの文言になる

- 場所: `monowa/backend/src/main/kotlin/com/monowa/presentation/error/DomainErrorMapping.kt:26`（error-handling）
- 根拠: DomainErrorMapping.kt:15 `DomainError.UnknownIntent, DomainError.UnknownLoan, DomainError.UnknownEmployee -> HttpStatus.NOT_FOUND`、:26 `DomainError.UnknownEmployee -> "指定された社員が見つかりません"`。PostIntentUseCaseImpl.kt:30-31 `val owner = employeeRepository.findById(actor.employee) ?: return DomainResult.Err(DomainError.UnknownEmployee) / if (!owner.isMember()) return DomainResult.Err(DomainError.UnknownEmployee)` — 本人が非会員でも「…
- なぜ問題か: 同じ状態 (トークンは正しいが本人が MonoWa 上の社員でない) が、コマンドなら 404 `unknownEmployee`、閲覧なら 404 `notMember`、クレーム欠落なら 403 `noActor` と 3 通りになり、画面の「使い始めてください」誘導が code ごとの分岐を要する。message「指定された社員が見つかりません」は本人に向けた文として誤解を招く。Lean の失敗語彙をそのまま写した結果で契約上は文書化されているが、Cradle の一般則としては避けたい形。
- 直し方: Lean 側で「呼び出し本人が会員でない」を `NotMember` 相当の 1 語に統一し、コマンド側の `UnknownEmployee` は宛先専用にする (または presentation で actor 起因の `UnknownEmployee` を `notMember` に写し直す)。文言テーブルは「本人向け」「宛先向け」を分ける。
- Cradle の規則: エラーコードは「状態」に対して一意にする: 同じ原因が読み取り/書き込み/境界で別コードにならないよう、失敗語彙の設計段階で「本人の資格が無い」と「宛先が無い」を別語として分離し、message も向き (本人/宛先) を区別する。

### [Low] 担当の名義 (`Steward`) だけ DI ではなく Controller の手動呼び出しで調達 — 呼び忘れると会員確認 (第二の門) が抜ける

- 場所: `monowa/backend/src/main/kotlin/com/monowa/presentation/steward/StewardEmployeeController.kt:38`（authz）
- 根拠: StewardEmployeeController.kt:30 `private val actorContextFactory: ActorContextFactory`、:38 `designateLeadershipUseCase.execute(actorContextFactory.steward(), …)`、:43、:47 も同様に各メソッドで手動呼び出し。社員の名義は ActorConfig.kt:25-31 でリクエストスコープ Bean として DI されるのに対し、`Steward` は DeactivateAccountUseCaseImpl.kt:33 `@Service` (非 `@ActorScoped`) の `execute(steward: Steward, …)` 引数。フィルタ層は `hasAuthority(STEWARD)` (SecurityConfig.kt:95-96) で印しか…
- なぜ問題か: `Steward` は `data object` (Steward.kt:39) なのでどこからでも `Steward` と書けて `execute(Steward, …)` を呼べる。担当の口を新設した開発者が `actorContextFactory.steward()` を呼ばずに `Steward` を渡すと、印はあるが未登録/無効化済みの人が指定・無効化を行える (契約 openapi.yaml StewardForbidden の 404 `unknownEmployee` が消える)。ktlint `actor-context-site` の監視対象は `ActorContext,EnrollingActorContext` (ActorContextSiteRule.kt:101) で `Steward` は含まれない。
- 直し方: `Steward` も `ActorConfig` でリクエストスコープ Bean にして (または `HandlerMethodArgumentResolver` で) Controller から `ActorContextFactory` 依存を消す。`ActorContextSiteRule` の既定 `types` に `Steward` を加え、`Steward` リテラルの出現も `presentation.auth` 外で禁じる。
- Cradle の規則: 名義の種別が複数ある場合、すべて同じ調達経路 (DI / 引数リゾルバ) に統一し、Controller に「名義ファクトリを手で呼ぶ」コードを残さない。名義型 (マーカー object を含む) の構築・参照場所は lint で一律に縛る。

### [Low] 本番でもアプリ起動時に DDL (DROP INDEX を含む) を毎回流す `spring.sql.init.mode: always`

- 場所: `monowa/backend/src/main/resources/application.yml:12`（persistence）
- 根拠: application.yml:10-13 `sql:\n    init:\n      mode: always\n      schema-locations: classpath:db/schema.sql` (プロファイル共通)。schema.sql:98 `DROP INDEX IF EXISTS idx_loan_origin_intent;`、:109-110 `DROP INDEX IF EXISTS idx_loan_lender; DROP INDEX IF EXISTS idx_loan_borrower;`。04_operations.md:95-96「PostgreSQL の `IF NOT EXISTS` は「存在確認 → 作成」の間を排他しない。同時に走ると、後から入った側がシステムカタログの一意制約にぶつかって落ちる」。本番は 2 タスク常駐 (03_aws-production.md:129)…
- なぜ問題か: アプリの DB ユーザ (RDS マスタ = ecs.tf:117-118 `${var.db_secret_arn}:username::`) に DDL 権限が常に要り、最小権限にできない。空スキーマへの初回同時起動の競合は文書化済みだが、将来の `DROP INDEX` 追加は稼働中の 2 タスク目の起動でも索引を一瞬落とす。スキーマ変更の履歴・ロールバックが無い。
- 直し方: Flyway/Liquibase に移し `spring.sql.init.mode` は `test`/`local` のみ `always` にする。本番の DDL は移行ジョブ (ECS RunTask) で 1 回だけ実行し、アプリの DB ユーザは DML 専用のロールに分ける。
- Cradle の規則: 本番プロファイルではアプリ起動時のスキーマ初期化を無効にし、マイグレーションツールと専用ジョブで DDL を流す。アプリ実行ユーザには DDL 権限を与えない (最小権限)。

### [Low] 認可の門のパス `/api/steward/` が SecurityConfig と AccessDeniedHandler で二重定義

- 場所: `monowa/backend/src/main/kotlin/com/monowa/presentation/error/MonoWaAccessDeniedHandler.kt:56`（authz）
- 根拠: MonoWaAccessDeniedHandler.kt:55-59 `/** SecurityConfig の振り分けと同じ前置き(片方だけ変えると語が食い違う)。 */ const val STEWARD_PATH = "/api/steward/" … @Suppress("unused") val GATE = SecurityConfig.STEWARD` と、SecurityConfig.kt:95 `.requestMatchers("/api/steward/**")`。`classify` は :49 `request.requestURI.startsWith(STEWARD_PATH) -> stewardOnly()`。
- なぜ問題か: パスを片方だけ変えると 403 の code が `stewardOnly` から `noActor` にずれるが、HTTP レベルのテストが無い (finding 3) ので気づけない。`GATE` は参照を作るだけで整合を保証しない。
- 直し方: `SecurityConfig` の companion に `STEWARD_PATH_PREFIX = "/api/steward/"` を置き、`requestMatchers("$STEWARD_PATH_PREFIX**")` と `classify` の両方がそれを参照する。または `AccessDeniedException` の発生元 (`AuthorizationDeniedException` の `AuthorizationResult`) から必要権限を取り、パス文字列に依存しない分類にする。
- Cradle の規則: 認可ルールの語彙 (パス・権限名・グループ名) は 1 つの定数の正本から参照し、文字列リテラルを 2 か所に書かない。拒否理由の分類は「どの権限が足りなかったか」から導き、URL の再解釈に頼らない。

#### そのまま持ち込んでよい良い実践

- deny-by-default の認可: `SecurityConfig.kt:91-99` は `permitAll` を `/api/healthcheck` だけに限り、`/api/steward/**` を `hasAuthority(STEWARD)`、残り全部を `anyRequest().hasAuthority(EMPLOYEE)` で閉じる。Cradle ルール: 「許可リストは公開エンドポイントだけ、`anyRequest()` は必ず認証+権限を要求する」。
- トークン検証の明示: `SecurityConfig.kt:47-55` が `JwtTimestampValidator` / `JwtIssuerValidator(properties.issuer)` / `aud.contains(properties.audience)` / `token_use == "id"` を `DelegatingOAuth2TokenValidator` で束ねる。Cradle ルール: 「署名・期限に加えて iss/aud/用途クレームを必ず検証し、根拠を KDoc に残す」。
- 名義はペイロードから作らない: `ActorContext` の構築箇所を `presentation/auth` (`ActorContextFactory.kt`) に限定し、ktlint 独自ルール `monowa:actor-context-site` (`backend/ktlint-rules/src/main/kotlin/com/monowa/ktlint/ActorContextSiteRule.kt:42-81`) が本番コードで機械検査、テストだけ `.editorconfig:80` で切る。生成契約テストが守れない一点 (名義の組み立て) を lint で埋める設計は Cradle に持ち込む価値が高い。
- 名義の種別を認証層で 1 か所に分ける: Controller は名義検査を書かず (`IntentController.kt:27-29`、`MeController.kt:23-26`)、`@ActorScoped` (`ActorScoped.kt:18-22`) のリクエストスコープ Bean で UseCase が DI で受け取る (`ActorConfig.kt:25-31`)。Cradle ルール: 「Controller は解決済み名義を運ぶだけ。誰を選ぶコードを書かない」。
- 「今日」をサーバの `Clock` から取る: `ClockConfig.kt:10-11` の `Clock` Bean を `LoanController.kt:145` `LocalDate.now(clock)` で使い、リクエストから受け取らない。テストは `Clock.fixed` に差し替え可能。
- 設定の fail-closed: `AuthProperties.kt:13-14`「ここに既定値を置かない — 未設定のまま起動が成功して検証していないトークンを受け入れる事故を作らない」、`application-prod.yml:1-9` も datasource/auth の既定値無し。本番の DB 資格情報は `infra/modules/backend-service/ecs.tf:116-119` の ECS `secrets` (RDS 管理シークレット `database/main.tf:95 manage_master_user_password = true`) で渡し、リポジトリに平文が無い。
- 検証を飛ばすプロファイルを作らない: `05_configuration.md:19-24` の規約どおり local も JWT+JWKS (`application-local.yml:23-27`) を通り、モック発行者 (`infra/envs/local/idp/Dockerfile` の `mock-oauth2-server`) を立てる。`application-test.yml` は `src/test/resources/` にあり本番 jar に同梱されない (`05_configuration.md:28-31`)。
- エラー契約の全経路統一: `UnauthenticatedEntryPoint.kt:29-35` (401)、`MonoWaAccessDeniedHandler.kt:38-42` (403) のフィルタ層と、`GlobalExceptionHandler.kt:20-63` (`ResponseEntityExceptionHandler` 継承で 405/415/406/404/400/500) が同じ `ErrorResponse(code, message)` を返す。500 は `"internal error"` 固定で内部を隠し (`:62`)、401 は例外メッセージを写さない (`UnauthenticatedEntryPoint.kt:18`)。
- 403 と 422 の分離: `DomainErrorMapping.kt:12-21` が宛先なし→404、立場ゆえ→403、その他業務失敗→422 と機械的に写し、`code` はモデルの失敗語彙 (`name.replaceFirstChar`) をそのまま使う (`:56`)。画面が分岐に使うのは code だけ (`openapi.yaml` ErrorCode enum)。
- 入力検証を契約から生成: `openapi.yaml` の `x-field-extra-annotation: '@field:jakarta.validation.constraints.NotBlank'` (例 `:1469-1473`) が生成 DTO に `@field:NotBlank` を付け、ネストにも `@field:Valid` が付く (生成 `TermsInput.kt:33`)。Controller に手書きの `require` が無い (`07_presentation.md:37-40` 準拠)。
- CORS を backend に持たない: `03_aws-production.md:26-30` の same-origin 設計 (dev は Vite proxy、prod は CloudFront が `/api/*` を ALB へ束ねる) により `SecurityConfig` に `.cors()` が無く、ブラウザからの越境呼び出しは既定で拒否される。
- コンテナの最小権限: `backend/Dockerfile:36-37,55` で非 root (`uid 10001`)、`TZ=UTC` 固定 (`:31-32`)、libfaketime は `WITH_FAKETIME=true` の local イメージにだけ焼き「JWT の exp 検証を回避しうる手段を本番の攻撃面に足さない」(`:19-25`)。`docker-entrypoint.sh:17` はライブラリの存在も確認してから有効化する。
- ログに PII/トークンが載らない: アプリのログ文は `GlobalExceptionHandler.kt:61` の例外ログ 1 つだけで、JWT 値・クレーム・リクエスト本文を出力する箇所は無い (grep `LoggerFactory|println|MDC` で他に hit なし)。

## バックエンド実装（UseCase・永続化・テスト）

### [High] @[contract] 定理が golden 0 件になっても黙って通る — ConfirmReturn の成功経路・RaiseHand の即成立経路に backend テストが存在しない

- 場所: `monowa/backend/src/generated/kotlin-test/application/usecase/confirmreturnusecase/ConfirmReturnUseCaseContractTest.kt:59`（testing）
- 根拠: Lean `ConfirmReturnUseCase/UseCase.lean:94 @[contract] theorem execute_ok` / `:157 act_no_turn_frame` が存在するが、生成 `ConfirmReturnUseCaseContractTest.kt` の 12 テストは `execute_not_lender`×4 / `execute_not_lent`×4 / `execute_unknown_loan`×4 のみ。`backend/build/lean2kotlin/lean2kotlin-ir.json` の `contracts` (269 件) に `ConfirmReturnUseCase.execute_ok` のエントリ自体が無い。同様に無いもの: `RaiseHandUseCase.execute_ok_borrow`(Lean:178) / `execute_…
- なぜ問題か: `ConfirmReturnUseCaseImpl.kt:47-48` (返却確認で一件が終わり番が回る = 業務の中心遷移) と `RaiseHandUseCaseImpl.kt:71-74` (その場で貸す相手が決まる) および `RaiseHandLoanEngagementBypassImpl.isFulfilling/borrowingIn` (`:24-45`) が backend 自動テストを一切通らない。サンプラー (seed 42) が Lent 段階+lender=actor のような構造化された前提を引けないと、定理は「存在するのにテストされない」状態に静かに落ちる。生成テスト数 (12 本) が多いため人間は網羅されていると誤認する。
- 直し方: lean2kotlin に定理→golden 件数の対応表を出力させ、`execute_*` 定理で 0 件のものは build を失敗させるか `@Disabled("no golden case for <theorem>")` の空テストを出して赤く見せる。Lean 側は前提を満たす状態を定理ごとに構成する `example`/`decide` 付きの明示ケースを許す (ランダムサンプリングに頼らない)。当面は ConfirmReturn/RaiseHand(borrow)/CallOff(空列) を手書きの Spring テストで補う。
- Cradle の規則: 契約テスト生成器は「定理 ↔ 生成ケース数」を必ず可視化し、execute レベルの契約定理が 0 件なら失敗または明示的な無効テストを出す。黙って 0 件にすることを禁じる。

### [High] 「二重には貸さない」の直列化点が無い — 同一表明への同時 raiseHand / passTurn が両方成立する

- 場所: `monowa/backend/src/main/kotlin/com/monowa/application/usecase/raisehandusecase/RaiseHandUseCaseImpl.kt:68`（transaction）
- 根拠: RaiseHandUseCaseImpl.kt:68-74 `if (waitsInLine(intent)) { intentRepository.update(intent.joinLine(...)) } else { ... loanRepository.add(LoanImpl.settle(loanIdGenerator.nextId(), ...)) }` / `:81-82 private fun waitsInLine(target) = loanEngagementBypass.isEngaged(target.id) || target.waiting.isNotEmpty()` — 読んでから書くだけ。`grep -rn forUpdate src/main/kotlin` → 0 件。schema.sql:99 `CREATE INDEX IF NOT EXISTS idx_loan_origin_in…
- なぜ問題か: H2 既定・PostgreSQL 既定とも READ COMMITTED (03_usecase.md も明記)。2 人が同じ Lend 表明に同時に手を挙げると両トランザクションが `isEngaged = false` かつ `waiting = []` を観測し、両方が `LoanImpl.settle` を add してコミットできる。モデルが定理で守っている `activeCount ≤ 1` が本番では成立せず、板の `engaged`、`activeFor` の `limit(1)`、TurnService の前提がすべて崩れる。生成契約テストは単一スレッドなのでこの欠陥を原理的に検出できない。
- 直し方: 書き込み経路で表明行をロックする: `IntentRepositoryImpl.findById` を `@Transactional` 内では `.forUpdate()` 付きで発行する (validate は境界外で呼ばれても auto-commit で無害) か、`LockIntentBypass` を raisehand/confirmreturn/calloff/giveup/deactivateaccount に宣言して `SELECT id FROM intent WHERE id = ? FOR UPDATE` を先頭で打つ。PostgreSQL 本番には加えて `CREATE UNIQUE INDEX uq_loan_active_per_intent ON loan(origin_intent) WHERE stage_kind IN ('COORDINATING','ARRANGED','LENT')` を張る (H2 は部分索引非対応なのでロックが可搬な主策)。並行テストを 1 本追加 (2 スレッドで同一表明に raiseHand → 成立 1 件)。
- Cradle の規則: Lean で `≤ 1` / `Nodup` / `unique` 形の不変条件が集約ルート横断 (Repository 集合上) に定義されているとき、実装はその不変条件ごとに直列化点 (行ロック or 一意制約) を KDoc で名指しし、並行 2 スレッドで違反しないことを検査するテストを 1 本持たなければならない。生成契約テストは単一スレッドであり代替にならない。

### [High] 集約の update が version 列も行ロックも無い全列上書き — 失われた更新が起きる

- 場所: `monowa/backend/src/main/kotlin/com/monowa/infrastructure/LoanRepositoryImpl.kt:123`（persistence）
- 根拠: LoanRepositoryImpl.kt:95-124 `val columns = mapOf<Field<*>, Any?>(LOAN.ORIGIN_KIND to ..., LOAN.PROPOSAL_PROPOSER_ID to proposal?.proposer?.id, ... LOAN.EARLY_ASKED to loan.earlyAsked)` → `:123 dsl.update(LOAN).set(columns).where(LOAN.ID.eq(loan.id.id)).execute()`。EmployeeRepositoryImpl.kt:46-54、IntentRepositoryImpl.kt:51-61 (`deleteFrom(INTENT_WAITING)` + 全再挿入) も同形。schema.sql に version 列なし。`documents/ai-notes/202609…
- なぜ問題か: `DiscussUseCase`(remarks 追記) と `ProposeTermsUseCase`(proposal 設定) が同じ一件に同時に走ると、後にコミットした側が読んだ時点の `proposal = null` を書き戻し相手の案が消える。`intent_waiting` の delete+reinsert は PK (intent_id, ord) 衝突で片方が 500 になるので偶然に守られているが設計ではない。`ActorContextFactory.open()` (トランザクション外の書き込み) と `deactivateAccount` の競合は既に「無効化の取り消し」として記録されている。
- 直し方: 各集約テーブルに `version BIGINT NOT NULL DEFAULT 0` を足し、Entity に `version` を持たせて `UPDATE ... WHERE id = ? AND version = ?` で 0 行なら例外 (技術的失敗として 409/500)。生成 Repository interface は変えられないので `LoanImpl` のコンストラクタ引数として version を運ぶ (fixture→entity 変換は `FixtureEntities.kt` に閉じているので影響は局所)。または `findById` を境界内で `FOR UPDATE` にする (finding 1 と同じ手当てで両方消える)。
- Cradle の規則: 生成 Repository の `update(aggregate)` 契約は「集約まるごと書き戻す」形になるので、実装は必ず楽観ロック (version) か悲観ロック (FOR UPDATE) のどちらかを選び、選択理由を Repository の KDoc に書く。Cradle は並行更新テストの雛形 (2 スレッド read-modify-write → 一方が失敗) を提供する。

### [Medium] LoanBoard/ClosedLoans の Row→View 射影 ~90 行が完全同一 — Lean では toView 1 定義、overdueOf は LoanRow.isOverdue の再実装

- 場所: `monowa/backend/src/main/kotlin/com/monowa/application/usecase/loanboardusecase/LoanBoardQueryServiceImpl.kt:118`（slop）
- 根拠: LoanBoardQueryServiceImpl.kt:118-208 と ClosedLoansQueryServiceImpl.kt:117-190 の `decodeOrigin`/`decodeStage`/`decodeProposal`/`decodePending`/`overdueOf`/`LocalDate.toView` は diff ゼロ。両クラスの本体差分は `:46 .and(LOAN.STAGE_KIND.notIn(CLOSED))` vs `:47 .and(LOAN.STAGE_KIND.in(CLOSED))` の 1 行。`:194-206 /** LoanRow.isOverdue の写し ... */ private fun overdueOf(...) = stageKind == "LENT" && returnDueOn != null && returnDueOn.isBefo…
- なぜ問題か: 03_usecase.md は「同じクエリが重複して構わない」と言うが、それは画面ごとの SQL の話で、Row→View 射影は Lean が `rfl` 定理で固定した**モデルの関数**である。3 組 (Entity 復元 1 + View 射影 2) に散った `decodeStage` は段階追加時に 3 箇所の `when` を直す必要があり、`overdueOf` は `Loan.isOverdue` (`LoanImpl.kt:103-104`) と同じ規則の 2 つ目の写し。
- 直し方: lean2kotlin が `toView` 定義から `fun LoanRow.toView(today, kind?): LoanView` と `LoanStage.toView(): LoanStageView` を生成する (現状 `LoanRow` はテスト側にしか無いので、本番側にも Row 型を出す)。QueryServiceImpl は列→Row の詰め替えだけを持ち、`overdue` はモデル生成の `LoanRow.isOverdue` を呼ぶ。
- Cradle の規則: Lean に `def toView`/`def isX` として書かれた射影・述語は生成器が Kotlin 関数として出し、手書き QueryServiceImpl は SQL と列→Row の詰め替えだけを担う。射影を手書きで複製した時点で規約違反とする。

### [Medium] Relationships の least/greatest 正規化が Lean linkOf の向き (one := lender, other := borrower) と一致しない — golden が lender==borrower のみで不可視

- 場所: `monowa/backend/src/main/kotlin/com/monowa/application/usecase/relationshipsusecase/RelationshipsQueryServiceImpl.kt:34`（drift）
- 根拠: RelationshipsQueryServiceImpl.kt:34-35 `val one = DSL.least(LOAN.LENDER_ID, LOAN.BORROWER_ID).as("one_id"); val other = DSL.greatest(...)`。Lean `RelationshipsUseCase/QueryService.lean:72-76 def linkOf ... { one := r.lender, other := r.borrower, ... }` と `dedupAux` (最初に現れた向きを残す)。生成 `RelationshipsUseCaseContractTest.kt` の期待値は `ConnectionView(one = EmployeeId(92), other = EmployeeId(92))` のみ (`grep -o` 結果 1 種類)、`Connect…
- なぜ問題か: lender=5, borrower=3 の一件が最初なら Lean は (5,3)、Kotlin は (3,5) を返し `assertEquals` で落ちる。frontend/e2e parity (Lean CLI と REST の突き合わせ) でも向きが違えば不一致になる。SQL の正規化は合理的だが、モデルが向きを持たない (`sameLink` で同一視) のに View の値としては向きを持っているという半端さが原因。
- 直し方: モデル側で `linkOf` を `min/max` 正規化に変える (View が向きを持たないことを値でも表す) か、SQL 側を `FIRST_VALUE(lender) OVER (PARTITION BY least,greatest ORDER BY seq_no)` で最初の向きを保つ。どちらにせよ非対称な golden (lender>borrower) を 1 件足す。
- Cradle の規則: QueryServiceImpl が SQL で値を正規化 (min/max・小文字化・丸め) するとき、その正規化がモデルの観測同値の範囲内であることを KDoc に式で書き、非対称データの golden を必ず 1 件持つ。

### [Medium] passTurn が nextId() を先行消費し Lean の fountain frame 定理に反する — DeactivateAccount だけ TurnService の判定を Kotlin で再実装して回避

- 場所: `monowa/backend/src/main/kotlin/com/monowa/application/usecase/confirmreturnusecase/ConfirmReturnUseCaseImpl.kt:55`（drift）
- 根拠: ConfirmReturnUseCaseImpl.kt:55 `val next = turnService.nextLoan(intent, loanEngagementBypass.isEngaged(intentId), loanIdGenerator.nextId()) ?: return`; CallOffUseCaseImpl.kt:58, GiveUpUseCaseImpl.kt:68 同形。DeactivateAccountUseCaseImpl.kt:92-95 `// 番が回らないと分かっているときは泉を消費しない(TurnServiceImpl.nextLoan の frame の写し) — nextId() は引数として先に評価されるため ... if (engaged || !intent.isOpen() || intent.nextInLine() == null) return`。Lean `Gi…
- なぜ問題か: 空列で返却確認/中止/降りるが起きるたび DB シーケンスが 1 消費される (業務上は無害) が、モデルは「番が回らなければ泉は動かない」を定理で固定しており、その golden が 1 件でも生成された瞬間に 3 ユースケースが落ちる。同じ規則が DeactivateAccount では Kotlin に複製されている (`engaged || !isOpen || nextInLine == null` は `TurnServiceImpl.nextLoan:30-31` の写し) ため、TurnService の規則変更が 1 箇所に閉じない。
- 直し方: モデルに持ち帰る: `TurnPassing.nextLoan` を `Intent → Bool → Option EmployeeId`(次の相手を決める) と `settle newId ...` に分け、UseCase 側で `nextInLineOf(...)?.let { loanRepository.add(settle(loanIdGenerator.nextId(), ...)) }` とする。生成 interface が変わるまでは 4 箇所の passTurn を DeactivateAccount と同じ guard 付きに揃え、guard が TurnService の写しであることを KDoc に書く。
- Cradle の規則: 採番 (fountain) の供給は決定関数の引数として先行評価してはならない。決定→採番→生成の順が型で強制される形 (決定関数は Id を受け取らない) に Lean 側で設計する。

### [Medium] schema.sql に DROP INDEX 型のマイグレーションが混入し毎起動で流れる — 版管理されたマイグレーションが無い

- 場所: `monowa/backend/src/main/resources/db/schema.sql:98`（infra）
- 根拠: schema.sql:98 `DROP INDEX IF EXISTS idx_loan_origin_intent;` / `:109-110 DROP INDEX IF EXISTS idx_loan_lender; DROP INDEX IF EXISTS idx_loan_borrower;` (コメント「旧定義 ... 索引名ごと張り替える」)。application.yml `spring.sql.init.mode: always` + `schema-locations: classpath:db/schema.sql`。`CREATE TABLE IF NOT EXISTS` のみで列変更の手段なし。外部キー無し (`RowSeeding.kt:14`「外部キーが無い ... ため、削除の順序は問わない」)。`stage_kind VARCHAR(16)`/`kind`/`standing` に CHECK 無…
- なぜ問題か: 永続 PostgreSQL では旧索引の DROP が永久に残り、次の列変更 (例: finding 3 の version 列) は `ALTER TABLE` を同じファイルに足すしかなく、jOOQ codegen の入力としての schema.sql と本番 DDL 履歴が同居して膨らむ。`IF NOT EXISTS` が「既存を黙って飛ばす」性質はコメント自身が指摘している。参照整合・値域は Kotlin 側の `checkNotNull`/`valueOf`/`error("unknown stage kind")` に依存。
- 直し方: schema.sql は jOOQ DDLDatabase の入力 (現在形) として保ち、実行時は Flyway/Liquibase の版付きマイグレーションに移す (V1 = 現 schema、以後 ALTER)。`stage_kind`/`kind`/`standing` に CHECK、`intent_waiting(intent_id, employee_id)` に UNIQUE、可能なら FK を足す (テストの clearAll は順序を持つよう直す)。
- Cradle の規則: schema.sql (codegen 入力) と本番マイグレーション (版付き) を分離する。schema.sql に DROP/ALTER が現れたらマイグレーション導入の合図とし、Cradle は Flyway 雛形と「schema.sql = V_latest の照合テスト」を提供する。

### [Medium] validate の戻り型が UseCase ローカルの Resolved 帰納型だと生成器が validate を黙って落とし、手書き側が固定形を崩している

- 場所: `monowa/backend/src/main/kotlin/com/monowa/application/usecase/giveupusecase/GiveUpUseCaseImpl.kt:40`（drift）
- 根拠: Lean `GiveUpUseCase/UseCase.lean:38-42 inductive Resolved ... | fromLine (i : Intent) | fromLoan (l : Loan)` / `:47 def validate ... : Except DomainError (Resolved ...)`; `StartUsingUseCase/UseCase.lean:47-52 def validate ... Except DomainError (Resolved ...)` (`.fresh | .returning e`)。IR `lean2kotlin-ir.json` `useCases[11] GiveUpUseCase ['execute']`, `useCases[23] StartUsingUseCase ['execute']` (validate 無し)。Extract…
- なぜ問題か: 03_usecase.md「execute は必ず validate を呼ぶ」「validate は公開のテストシーム」が 2 ユースケースで満たせない。生成契約テストも validate を呼べない (`grep -c '.validate(' GiveUpUseCaseContractTest.kt` → 0)。生成器の除外が info ログのみなので、interface を見た実装者は「このユースケースには validate が無い」と誤解する (KDoc は「固定形 validate / execute」と書いたまま)。
- 直し方: lean2kotlin: UseCase ローカルの `Resolved` 帰納型を `LoanOrigin` と同じ sealed interface として生成し validate を出す。少なくとも skipped は warning に上げ、生成 interface に `// GENERATOR-SKIPPED: validate (戻り型 Resolved を写像できない)` を焼き込む。手書き側は当面 `private fun resolve(c): DomainResult<DomainError, Resolved>` を切り出し execute から呼ぶ形にして固定形に寄せる。
- Cradle の規則: 生成器は入力 (Lean) にあるものを出力から落とすとき、必ず warning 以上のログと生成物内の明示マーカーを残す。silent skip を禁じ、生成物の KDoc は実際に生成されたメンバだけを語る。

### [Medium] トランザクション境界が一度も検査されない — 契約テストは new で組み立てるため @Transactional/@ActorScoped を通らず、複数集約書き込みの巻き戻しテストも無い

- 場所: `monowa/backend/src/test/kotlin/com/monowa/application/usecase/confirmreturnusecase/ConfirmReturnUseCaseImplContractTest.kt:1`（testing）
- 根拠: RaiseHandUseCaseImplContractTest.kt:58-65 `RaiseHandUseCaseImpl(employeeRepository, intentRepository, loanRepository, loanIdGenerator, RaiseHandLoanEngagementBypassImpl(dsl), actor)` (Spring プロキシ無し)。全 26 本が同形。ConfirmReturnUseCaseImpl.kt:47-57 は `loanRepository.update` → `intentRepository.update(intent.advanceLine())` → `loanRepository.add(next)` の 3 書き込みを 1 境界に置くが、3 つ目が失敗したとき前 2 つが戻ることを検査するテストは無い。`src/test` に MockMvc…
- なぜ問題か: `@ActorScoped` = `@Service + @Scope(request, INTERFACES)` に `@Transactional` を重ねる配線は Spring の細部 (kotlin-spring の meta-annotation open、JDK proxy の順序) に依存しており、動くことを保証しているのは手動確認だけ。`GlobalExceptionHandler`/`DomainErrorMapping` を通る経路も未検査。
- 直し方: `@SpringBootTest` で Bean 経由 (`@Autowired ConfirmReturnUseCase`) に `MockHttpServletRequest` を張って呼び、`LoanIdGenerator` を「既存 id を返す」実装に差し替えて `loanRepository.add(next)` で PK 違反を起こし、`loan` と `intent_waiting` が変わっていないことを両方向で assert するテストを ConfirmReturn/CallOff/GiveUp/DeactivateAccount に 1 本ずつ。加えて Controller 1 本の `@WebMvcTest` で 404/403/422 の写像を検査。
- Cradle の規則: 複数集約を 1 境界で書くユースケースには、生成契約テストとは別に「境界の中で 2 番目以降の書き込みを人為的に失敗させ、最初の書き込みが残らない」ことを本番プロキシ経由で検査するテストを必須にする。

### [Medium] 閉じた段階のタグ集合が本番 9 ファイル+テストに文字列リテラルで重複 — LoanStageBehaviors.isActive/isDropped の再符号化

- 場所: `monowa/backend/src/main/kotlin/com/monowa/infrastructure/LoanRepositoryImpl.kt:213`（slop）
- 根拠: `grep -rln '"COMPLETED", "DROPPED_OUT", "CALLED_OFF", "LAPSED"' src` → LoanBoardQueryServiceImpl.kt:114, ClosedLoansQueryServiceImpl.kt:113, IntentBoardQueryServiceImpl.kt:120, CallOffLoanEngagementBypassImpl.kt:20, ConfirmReturnLoanEngagementBypassImpl.kt:20, RaiseHandLoanEngagementBypassImpl.kt:21,44, GiveUpActiveLoanBypassImpl.kt:30, WithdrawIntentActiveLoanBypassImpl.kt:26, DeactivateAccountTouchedByDeactivateByp…
- なぜ問題か: `LoanStage` に段階を 1 つ足すと `kindTag` の `when` はコンパイルエラーで気づけるが、`notIn("COMPLETED", ...)` のリストは網羅性検査が無く、新段階が「進行中」として扱われる/扱われないが静かにずれる。これはモデルの `isActive` 定義が 10 箇所に散った状態で、jooq-access-site 規約が「共有ヘルパ禁止」なので infrastructure 内でも共通化されていない。
- 直し方: `infrastructure/LoanStageTag.kt` に `enum class LoanStageTag { COORDINATING, ... }` と `val CLOSED_TAGS = LoanStageTag.entries.filter { !LoanStageBehaviorsImpl().isActive(it.sample()) }` のように振る舞い実装から導出した集合を置き、テストで `LoanStage` の sealed サブクラス集合 ↔ タグ集合の全単射を検査する。QueryServiceImpl からの参照は jooq-access-site の許可パッケージ (`com.monowa.infrastructure`) なので規約に触れない。長期的には lean2kotlin が sealed 型の永続化タグを生成する。
- Cradle の規則: sealed/enum のモデル型を DB に符号化するとき、タグの enum と「振る舞い (isActive 等) から導出した部分集合」を 1 ファイルに生成し、網羅性テストを付ける。述語のリテラル列挙を複数ファイルに書くことを禁じる。

### [Low] LoanRepositoryImpl.update が毎回 remarks を読み直して diff、IntentRepositoryImpl.update は常に waiting を delete+reinsert

- 場所: `monowa/backend/src/main/kotlin/com/monowa/infrastructure/LoanRepositoryImpl.kt:67`（persistence）
- 根拠: LoanRepositoryImpl.kt:67-78 `insertOrUpdateLoanRow(...); val stored = remarksOf(loan.id); if (stored == loan.remarks) return; if (... take(stored.size) == stored) { appendRemarks(...) ; return }; dsl.deleteFrom(LOAN_REMARK)...; appendRemarks(...)`。IntentRepositoryImpl.kt:51-61 `update(INTENT)...; deleteFrom(INTENT_WAITING).where(...).execute(); insertWaiting(...)` (withdraw() だけの更新でも列を全消し全入れ)。
- なぜ問題か: 段階を進めるだけの update で SELECT 1 本が増え、`intent_waiting` は変更が無くても行が入れ替わる (PK 衝突の温床 — finding 3)。KDoc は理由を丁寧に書いているが、生成 Repository 契約が「集約まるごと」なので子コレクションの差分検出を実装が背負う構造的問題。
- 直し方: Entity に「読み込んだ時点の子コレクション」を保持させて差分だけ書く (dirty tracking) か、finding 3 の version 列導入と同時に `update` を「親行 UPDATE + 子は差分適用」に統一する。`IntentImpl.waiting` が不変なら delete+reinsert を skip。
- Cradle の規則: 集約まるごと update の契約を持つ Repository 実装は、子コレクションの書き方 (差分 / 全入れ替え) と追加読み取りの有無を KDoc に明記し、追加 SELECT が発生する場合は ExecuteListener で文数を固定するテストを持つ。

### [Low] ReadModelDdlContractTestImpl の KDoc が古く、engaged/fulfilled SQL の 3 つ目の写しを持つ

- 場所: `monowa/backend/src/test/kotlin/com/monowa/application/readmodel/ReadModelDdlContractTestImpl.kt:39`（testing）
- 根拠: ReadModelDdlContractTestImpl.kt:39-41 「`IntentBoardReadModel`/`MyLineReadModel`/`RelationshipsReadModel` の 3 つは、**生成された契約テストからは 1 度も呼ばれない**」— 生成 `ReadModelDdlContractTest.kt` は `retrieveIntentBoardReadModel(`/`retrieveMyLineReadModel(`/`retrieveRelationshipsReadModel(` を各 1 回呼ぶ (`grep -o ... | uniq -c` → 各 1)。`:71-83 engagedBySql/fulfilledBySql` は IntentBoardQueryServiceImpl の EXISTS と NOT_DROPPED を再記述、`:165 CLOSED` …
- なぜ問題か: 「本番と同じ SQL が実行されているか」を狙った設計だが、同じ SQL を手で 3 回書いた時点で「同じ」は保証されず、コメントの前提 (呼ばれない) も再生成で崩れている。
- 直し方: KDoc を現状に合わせて直し、`engagedBySql/fulfilledBySql` は finding 7 の共通述語を参照する形にする。
- Cradle の規則: 生成テストの呼び出し状況を語るコメントは再生成で腐るので書かない。書くなら grep 可能な検証コマンドではなく assert (例: 生成テストのメソッド数) に落とす。

### [Low] enum の DB 符号化が 2 流儀 — IntentKind/Standing は enum.name ("Borrow"/"Member")、LoanStage/LoanOrigin は手書き UPPER_SNAKE タグ

- 場所: `monowa/backend/src/main/kotlin/com/monowa/infrastructure/IntentRepositoryImpl.kt:43`（persistence）
- 根拠: IntentRepositoryImpl.kt:43 `.set(INTENT.KIND, intent.kind.name)` / `:97 IntentKind.valueOf(this[INTENT.KIND])`; EmployeeRepositoryImpl.kt:41 `.set(EMPLOYEE.STANDING, employee.standing.name)`; seed-local.sql `'Member'`, `'Leadership'`; IntentBoardQueryServiceImpl.kt:132 `val BORROW = IntentKind.Borrow.name`。対して LoanRepositoryImpl.kt:197-222 `"RAISED_HAND"`, `"COORDINATING"` ... の手書きタグ。
- なぜ問題か: `IntentKind.Borrow` を Lean 側で改名して再生成すると保存済み行が `valueOf` で落ちる (データ移行が必要になることが型に現れない)。同じスキーマ内で流儀が混在しているので、新しい列挙型を足すときどちらに倣うか判断が要る。
- 直し方: finding 7 の `*Tag` enum 方式に統一し、`name` 依存をやめる。生成器が VO enum ごとに永続化タグを出せばモデルの改名と DB 表現が分離する。
- Cradle の規則: モデルの enum/sealed 名を DB 表現に直接使わない。永続化タグは別 enum として生成し、モデル名の変更が DB に波及しないことを保証する。

### [Low] passTurn の 4 重複製と isEngaged/activeFor SQL の 5 重複製 — バイパス実装側は「共有しない」規約の対象外なのに複製されている

- 場所: `monowa/backend/src/main/kotlin/com/monowa/infrastructure/CallOffLoanEngagementBypassImpl.kt:14`（slop）
- 根拠: `grep -rn 'private fun passTurn'` → ConfirmReturnUseCaseImpl.kt:53, CallOffUseCaseImpl.kt:56, GiveUpUseCaseImpl.kt:63, DeactivateAccountUseCaseImpl.kt:89 (各 5-8 行、TurnService+IntentRepository+LoanRepository+IdGenerator の同じ編成)。`isEngaged` の `fetchExists(selectOne().from(LOAN).where(ORIGIN_INTENT.eq).and(STAGE_KIND.notIn(...)))` が CallOff/ConfirmReturn/RaiseHand/DeactivateAccount の 4 ファイルで byte 同一、GiveUp は `activeIdOf …
- なぜ問題か: KDoc の観測同値式 (`isEngaged(id) ≡ findAll().any { it.isActive() && it.intent() == id }`) は機械可読な仕様であり、生成器が SQL 実装を出せる典型。passTurn は「番回し」というドメインサービスの呼び出し手順であり 4 箇所が微妙に違う (DeactivateAccount だけ guard あり — finding 5)。
- 直し方: infrastructure 内に `private object LoanEngagementSql { fun engaged(dsl, intentId): Condition ... }` を置いて 5 実装が委譲する (jooq-access-site 許可パッケージなので規約に触れない)。passTurn は `TurnService` の署名変更 (finding 5) と併せて `TurnPassingImpl` (DomainService 実装) に「決めて・進めて・足す」を寄せ、UseCase は 1 行で呼ぶ。
- Cradle の規則: バイパスの KDoc に書く観測同値式は生成器の入力 (仕様) として扱い、SQL 実装の雛形を生成する。DomainService の「呼び出し手順」が複数 UseCase で同形なら DomainService 実装側に置く。

### [Low] validate が生成 Loan の can* 述語を使わず基底述語から再導出する箇所と使う箇所が混在 — 同じ規則が 2 重に符号化

- 場所: `monowa/backend/src/main/kotlin/com/monowa/application/usecase/acceptextensionusecase/AcceptExtensionUseCaseImpl.kt:25`（drift）
- 根拠: AcceptExtensionUseCaseImpl.kt:25-27 `if (!loan.isLent()) ... if (loan.extended) ... if (loan.pending == null) ...` vs `LoanImpl.kt:141 canAcceptExtension() = isLent() && pending != null && !extended`。同様に RemindUseCaseImpl.kt:30-31 vs `canRemind(today)`、AskEarlyReturnUseCaseImpl.kt:30-31 vs `canAskEarly(today)`、ProposeExtensionUseCaseImpl.kt:25-26 vs `canProposeExtension()`、WithdrawExtensionUseCaseImpl.kt:25-27 vs `ca…
- なぜ問題か: Lean の validate 自体が同じ分解 (`AcceptExtensionUseCase/UseCase.lean` validate) をしているので Kotlin は忠実な写しだが、結果として `can*` (Entity 側) と validate (UseCase 側) が同じ規則を 2 度持つ。両者がずれると validate は Ok を返し Entity は no-op して `Ok(Unit)` で何も起きない — 契約テストが無い定理 (finding 2) の領域では検出されない。
- 直し方: モデル側で validate を `can*` 述語の合成として定義するか、エラー粒度に対応する分解済み述語 (`isLent`, `hasPendingExtension` 等) を Entity 面に出し、validate はそれだけを呼ぶ。Kotlin 側は当面 `require(loan.canAcceptExtension())` を execute の Ok 分岐に置いて不一致を例外化する。
- Cradle の規則: validate は Entity/VO の生成述語だけを呼ぶ。エラー粒度のために分解が要るなら分解済み述語を Lean の Entity 面に出し、UseCase 側で基底フィールドから規則を組み立てない。

### [Low] 設定・ドキュメントの小さな drift — .editorconfig のルール一覧 7/8、ktlint-rules の description、build.gradle.kts のタイムゾーン参照先

- 場所: `monowa/backend/.editorconfig:17`（config）
- 根拠: .editorconfig:17-23 の独自ルール一覧は 7 本 (`actor-context-site` が無い) だが MonoWaRuleSetProvider.kt:16-25 は 8 本を登録、06_lint.md の表は 8 本。ktlint-rules/build.gradle.kts:7 `description = "MonoWa 独自の ktlint ルール(1ファイル1クラス・Bean 定義の作法)"`。build.gradle.kts:207 `// MonoWaApplication.kt 参照 — JDBC の日付往復変換が JVM既定タイムゾーンに依存するため、アプリ本体と同じく UTC に固定する` — Application.kt にタイムゾーン設定は無く、実体は Dockerfile:32 `JAVA_TOOL_OPTIONS="... -Duser.timezone=UTC"`。`Clo…
- なぜ問題か: 実害は小さいが、Cradle が「ルールを足したら 3 箇所 (Provider / .editorconfig 一覧 / 06_lint.md 表) を揃える」ことを機械化しないと同じ drift が再発する。ローカル bootRun での「今日」はホスト TZ 依存で、Lean CLI の固定 today との parity が日付境界でずれうる。
- 直し方: .editorconfig の一覧コメントを `MonoWaRuleSetProviderTest` から生成する (または一覧を消して 06_lint.md へのリンクだけにする)。build.gradle.kts のコメントを Dockerfile 参照に直し、`bootRun` にも `systemProperty("user.timezone","UTC")` を足す。
- Cradle の規則: 同じ一覧 (ルール名・環境変数・プロファイル) を複数ファイルに手で写さない。1 箇所を正本にし、他は生成またはテストで突き合わせる。

#### そのまま持ち込んでよい良い実践

- 固定形 validate/execute の徹底: 24/26 の UseCaseImpl が `when (val resolved = validate(c))` の骨格で execute から validate を自己呼び出しし、`@Transactional` は execute のみ (validate には付けない)。参照系も `@Transactional(readOnly = true)` + 空 validate の形を揃えている (`IntentBoardUseCaseImpl.kt:30-35` 等)。
- Repository 内でトランザクションを張らない: `grep transaction src/main/kotlin/com/monowa/infrastructure` 0 件。境界は UseCase.execute に一本化されている。
- Repository の N+1 回避: `LoanRepositoryImpl.findWhere`(`:42-47`)/`IntentRepositoryImpl.findWhere`(`:33-38`) が親を 1 本、子を `IN (subselect)` 1 本で引き、全件時は `noCondition()` で IN を外す根拠までコメント化 (`:145-149`)。バイパス実装は同一性だけ SQL で絞り実体化を `findWhere`/`findById` に委譲して復元経路を二重化しない (`DeactivateAccountTouchedByDeactivateBypassImpl.kt:15-17`, `GiveUpActiveLoanBypassImpl.kt:13-14`)。
- QueryService の絞り込み・並びを DB に任せている: `LoanBoardQueryServiceImpl.kt:42-52`(WHERE 当事者 + `notIn(CLOSED)` + `ORDER BY seq_no`) は Lean `visibleTo`(`r.isParty && r.isActive`, 保存順) の忠実な写し。`IntentBoardQueryServiceImpl.kt:49-80` の相関 EXISTS は Lean `boardRows`(`i.kind == .borrow && ls.fulfilling`) と観測同値で、H2 が LATERAL を解さない理由まで書かれている。`RelationshipsQueryServiceImpl.kt:45-58` は畳み込み・重複排除・在籍絞りをすべて SQL で行い `ORDER BY MIN(seq_no)` で Lean の dedupAux の順序を再現。
- 性能バイパスの規律: 宣言は消費 UseCase のパッケージ (`raisehandusecase/LoanEngagementBypass.kt` 等 7 件)、実装は `infrastructure/`、KDoc に `findAll()` ベースの観測同値式を必ず書く (`TouchedByDeactivateBypass.kt:16-24`)。`bypass-site` ルールが import・宣言・実装の置き場を機械検査 (`BypassSiteRule.kt`)。判断を持ち込まない例として `ViewerStandingBypass` は `Standing` 値だけ返し `isLeadership` はドメインに残す (`:13-15`)。
- DeactivateAccount の SQL 設計: `owner_id = ? OR id IN (...)` を避け UNION に割って両索引を効かせる根拠コメント (`DeactivateAccountTouchedByDeactivateBypassImpl.kt:24-29`)、`intentsTouching` の観測同値 `filter { owner == e || e in waiting }` を KDoc で固定。
- schema.sql の索引に述語との対応根拠が書かれている (`schema.sql:88-99` `idx_loan_origin_intent_stage` は `origin_intent = ? AND stage_kind NOT IN` の形に合わせ `stage_handed_over` まで載せてヒープ回避; `:101-112` 当事者別 BitmapOr; `:114-118` index-only scan 狙いの `idx_loan_connections`)。jOOQ 生成と実行時 DDL が同じ `schema.sql` を読む単一正本。
- ID 採番は DB シーケンス (`LoanIdGeneratorImpl.kt:11` `dsl.nextval(LOAN_ID_SEQ)`) を execute の境界内で呼び、生成契約テストは `SequentialLoanIdGenerator` を注入して決定性を得る。`seq_no` を業務語彙に出さず保存順専用に分離 (`schema.sql:9`)。
- テスト配線に fake が無い: 全 `*ImplContractTest` が本番 `*RepositoryImpl`/`*QueryServiceImpl`/`*BypassImpl` を実 H2 相手にそのまま組み立て (`RaiseHandUseCaseImplContractTest.kt:58-65`)、`no-repository-fake` ルールがテストソースで許可パッケージを空にして機械化。`IntentBoardUseCaseImplContractTest` は `engaged/fulfilled` を InMemory で読み替えず `backingLoanFor` で最小の裏付け Loan を播いて本番 SQL に判定させる (`BoardBacking.kt:18-31`)。
- 隔離は `RowSeeding.clearAll` を各 hook 冒頭で実行し、生成テストは全 hook を播種前に呼ぶ (`RaiseHandUseCaseContractTest.kt:68-70`) ので三重 clear は安全。並列化禁止と `maxParallelForks` 代替の明記 (`04_testing.md`)。
- `ActorContextFactoryTest` が `ExecuteListener` で発行 SQL 本数を数え、`open()` が所属不変なら UPDATE を出さない退行を fake 無しで検査 (`:227-259`)。
- Entity 実装は不変で新インスタンスを返し (`LoanImpl.copy`)、`TermsImpl` を data class にして `TermsProposal`/`LoanStage` の構造等価が成立。`LoanImpl` は段階が合わないとき何もせず拒否は validate に委ねる分担が KDoc で明示 (`:18-24`)。
- 「今日」は `java.time.Clock` を注入し Controller で `LocalDate.now(clock)` (`LoanController.kt:145`)、リクエストから受け取らない。Dockerfile が `-Duser.timezone=UTC`、テストも `user.timezone=UTC` で暦日判定を固定。
- 名義の構築点を `ActorContextFactory` 1 箇所に限定し `actor-context-site` ルールで機械検査。`ActorContext`/`EnrollingActorContext` は request スコープ Bean で `@ActorScoped` の UseCase に素の値として注入 (`ActorConfig.kt`, `ActorScoped.kt`)。
- ktlint 独自ルール 8 本すべてにテストがあり、`MonoWaRuleSetProviderTest` がコンパイル済み Rule クラスと `getRuleProviders()` を突き合わせて登録漏れを検出。`jooq-access-site` は import に加えて完全修飾参照と許可ファイルへの非 private 同居の 2 つの抜け道を塞ぐ (`JooqAccessSiteRule.kt:33-39`)。
- `DomainErrorMapping.kt:23-55` は `when` を網羅的に書いているので `DomainError` 追加時にコンパイルで検出される。
- 生成 interface と手書き実装の署名は完全一致 (`Loan` の 34 メソッド、`Intent` 10、`Employee` 7 をすべて override)。`LoanStageBehaviorsImpl.afterHandover/isDropped` の `Lapsed.handedOver` 分岐は Lean と一致。

## フロントエンド

### [High] OIDC の authorize/token エンドポイントを `${issuer}/authorize` `${issuer}/token` に決め打ち — 本番 Cognito では成立しない

- 場所: `monowa/frontend/src/auth/session.ts:132`（authz）
- 根拠: session.ts:132 `window.location.assign(`${config.issuer}/authorize?${query.toString()}`)` / session.ts:179 `await fetch(`${config.issuer}/token`, {` / config.ts:11 コメント「発行者。`iss` そのもので、ここに `/.well-known/openid-configuration` がぶら下がる」だが discovery を読むコードは無い。infra/modules/identity/outputs.tf:1-4 は issuer を `https://cognito-idp.${region}.amazonaws.com/${pool_id}` と定義し、outputs.tf:21-24 `login_url` = `https://${domain}.auth…
- なぜ問題か: ローカルのモック発行者（navikt/mock-oauth2-server）は `/{issuerId}/authorize` `/{issuerId}/token` を issuer 直下に置くが、Cognito は `authorization_endpoint` / `token_endpoint` をホスト UI ドメイン（`/oauth2/authorize` `/oauth2/token`）に置く。いまのコードは「モック発行者の URL 配置」を本番にも仮定しており、`pnpm build` して S3 に置いた画面はサインインボタンで 404 に飛ぶ。INFRA-D-018 が狙った「認証の不具合を本番でだけ踏まない」が、画面側でまさに破られている。session.test.ts は URL の origin+pathname を `http://issuer.test/monowa/authorize` と固定しているので、この仮定を試験が追認してしまっている。
- 直し方: `${issuer}/.well-known/openid-configuration` を起動時に 1 回読み、`authorization_endpoint` / `token_endpoint` をそこから取る（モックも Cognito も同じ discovery を出す）。読めない場合は幕に理由を出す。session.test.ts は discovery を fetch モックで与える形に改め、`issuer` と endpoint が別ホストになるケースを 1 本足す。
- Cradle の規則: OIDC/OAuth2 のエンドポイントは issuer 文字列から組み立てず、必ず discovery（`/.well-known/openid-configuration`）から取る。ローカルのモック IdP の URL 配置を本番 IdP に仮定してはならず、認証の単体テストには「issuer と authorization_endpoint のホストが異なる」ケースを必ず含める。

### [High] README / CLAUDE.md がコードと乖離（6 画面・`#/mine/*`・`lib/mine.ts`・`ScopeNote.tsx`・「板 3 本」）

- 場所: `monowa/frontend/README.md:117`（drift）
- 根拠: README.md:117-124 の画面表は 6 行（`#/mine/arranging` `#/mine/inhand` `#/intents/:id` …）だが MonoWaProvider.tsx:32-38 の `Route` は `intents | loans | closed | line | relationships` の 5 枚で、hashOf は `#/closed` `#/line` を出す（MonoWaProvider.tsx:57-70）。README.md:166「`components/ScopeNote.tsx`」、README.md:169「モデルの述語を写した箇所は `lib/mine.ts` の 3 つだけ」、README.md:173「この 4 画面は…前借り」— `ls src/lib src/components` に mine.ts も ScopeNote.tsx も無く、実体は…
- なぜ問題か: README は CLAUDE.md:225 で「規約の正本」と宣言されている。正本が存在しないファイル名・存在しない画面・「写しを 3 つから増やさない」という既に破られた上限を掲げていると、次に読む人（人でも AI でも）が `mine.ts` を探して見つからず、13 述語ある visible.ts を「増やしてはいけない写し」と衝突していると誤読するか、逆に規約を無効とみなす。Cradle が「README を正本にする」哲学を継承するなら、正本の腐り方そのものが最大のリスクになる。
- 直し方: README の画面表を `Route` 型に合わせて 5 行に直し、`ScopeNote.tsx`→`IntentBoard.tsx` のしぼり込みバー、`lib/mine.ts`→`lib/visible.ts` に書き換え、「3 つだけ」を「visible.ts の `allowedOn` 1 表＋`joinsLine`」のように現状の棚卸しに置き換える。CLAUDE.md:234-238 も同時に直す。以後の腐りを止めるため、`Route['screen']` の一覧と README の表を突き合わせるテスト（または README の表を生成する script）を置く。
- Cradle の規則: 「正本」と宣言した README には、コードから機械的に検証できる項目（画面/ルート一覧、モデル述語の写しの所在、コンポーネント名）を手書きしない — 生成するか、存在検査テストで縛る。規約に「N 個だけ・増やさない」と上限を書くなら、その数を数えるテストを同時に置く。

### [High] 期限切れ・無効トークン（401 unauthenticated / 403 noActor）の扱いが無く「板が見つかりません」の行き止まりになる

- 場所: `monowa/frontend/src/state/boards.ts:88`（error-handling）
- 根拠: boards.ts:87-89 `if (failure?.code === 'notMember') return { state: 'notMember', ... }` / `return { state: 'unreachable', detail: detailOf(failed.error), retry }` — 401/403 の境界語彙は分岐されず unreachable に落ちる。App.tsx:105-106 は unreachable で `<Unreachable ... onRetry={gate.retry} />` を出すが、この幕にはサインアウトの口が無い（Masthead は App.tsx:108-118 の shell 内でしか描かれない）。useAct.ts:36-42 も 401 を `announce('trouble', `モデルに届きませんでした（…）`)` にする。sessio…
- なぜ問題か: ID トークンは 1 時間で切れる。開いたままの画面は 1 時間後から全操作が「届きませんでした」になり、リロードすると `currentSession()` が期限切れトークンを読んで actor を立て、GET が 401 → 「板が見つかりません／もう一度つなぐ」。retry は同じ 401 を繰り返し、利用者は sessionStorage を消す術を知らない限り抜けられない。設備の不調（unreachable）と身元の失効を混ぜたことで、README が重視する「拒否と不達を言い分ける」が身元の軸で崩れている。
- 直し方: `failureOf(error).code === 'unauthenticated'` を gate と useAct の両方で拾い、`signOut()` してサインインの幕へ戻す（理由を `signInTrouble` に載せる）。`noActor` は NotAnEmployeeCurtain に写す。最低限、Unreachable の幕にもサインアウトの導線を置く。App.test.tsx に「401 が返ったらサインインの幕に戻る」を 1 本足す。
- Cradle の規則: 契約の境界語彙（401 / 403 noActor 等）は「届かなかった」に混ぜず、必ずセッション破棄→サインイン導線に写す。トークンに寿命がある以上「期限切れは 401 で返る」と書くだけでは足りず、401 を受けたときの画面遷移をテストで固定する。

### [Medium] Lean コマンド形（`LeanCommand`）は手書きの写しで、golden の `trace[].command` が使われていない

- 場所: `monowa/frontend/src/api/lean/wire.ts:127`（testing）
- 根拠: wire.ts:1-2「lean/MonoWa/Runtime/Json.lean が固定した JSON の形の写し」/ :127-145 `export type LeanCommand = | { startUsing: … } | …`。leanFetch.ts:154-183 の `INTENT_POSTS` / `LOAN_POSTS` は 16 ルート分の本文→コマンド変換を持つが、leanFetch.test.ts:99-125 が形を確かめるのは `raiseHand` と `postIntent` の 2 つ。lean/golden/basic-flow.json の trace には 14 コマンド（proposeTerms / agreeTerms / handOver / remind / askEarlyReturn / confirmReturn …）の実物があり、test/golden.ts:76-…
- なぜ問題か: 詰め替えは双方向だが、golden × スキーマで縛られているのは Lean→契約の片道だけ。契約 Request→Lean コマンドの向きは Json.lean のキー名が変わっても型は落ちず（`LeanCommand` は手書き）、dev で全コマンドが「protocol error」になるまで気づけない。20260821-04 の「wire の cancelHand フィールド名」事故はまさにこの向きで起きている。
- 直し方: golden の `trace[].command` を材料に、各ルートの `commandOf(path, body)` の出力が golden の同名コマンドと deep-equal になるテストを置く（契約側の body は golden から逆算するか、TermsInput 等を golden の値で組む）。さらに「LOAN_POSTS/INTENT_POSTS の全キーに golden の実例が 1 つ以上ある」ことを確かめ、実例の無いコマンドをシナリオ追加の要求として上げる。
- Cradle の規則: 仕様（Lean）と UI の詰め替えは両方向を golden で縛る: 応答方向は golden views × 契約スキーマ、要求方向は golden trace のコマンド実物 × 変換関数の出力。golden helper を定義したら利用箇所が無い状態を放置しない。

### [Medium] StrictMode 二重マウントの競合: leanFetch が `request.signal` を無視するため、取り消されたはずの 1 巡目が世界を read-modify-write し続ける

- 場所: `monowa/frontend/src/api/lean/leanFetch.ts:319`（e2e）
- 根拠: main.tsx:34 `<StrictMode>`。openapi-react-query/dist/index.mjs:10 `await fn(path, { signal, ...init })` と :34-39 で queryFn の `signal` を fetch に渡している。leanFetch.ts:319-336 の `leanFetch(request)` は `request.signal` を一度も参照せず（`grep -rn signal src` は空）、:317 `let chain` で全リクエストを直列化して必ず CLI を叩き、:245-249 / :302-305 で `snapshot` を差し替える。documents/ai-notes/20260902-01:24-44 は「2 巡届く」「押した操作の効果が板に反映されない」を実測し「製品側で対応が要るかは未検証」。e2e/src/…
- なぜ問題か: StrictMode は開発ビルドでだけ effect を二重に走らせる（本番では no-op）。TanStack Query は最後の observer が外れたときに `signal` を abort し、再マウントで再取得する — REST 相手なら 1 巡目はブラウザが本当に中断するが、leanFetch は abort を無視して 1 巡目・2 巡目の `views` を両方 CLI に流し、その間に割り込んだ POST と `snapshot` の順序が絡む。つまりこの競合は **dev の相手（Lean）でしか起きない dev 固有の現象**で、e2e の Lean↔REST parity が本番には存在しない差を追いかけている。ai-note が「本番でも起きるかは未検証」のまま置いているのは、Cradle に持ち込むと同じ調査を繰り返させる。
- 直し方: (1) leanFetch で `request.signal.aborted` を chain の先頭で見て、取り消されたリクエストは CLI に流さず `AbortError` で reject する（世界も触らない）。(2) e2e が dev サーバを叩くときは `VITE_STRICT=0` 等で StrictMode を外せる口を用意するか、README に「StrictMode は dev 専用、本番では起きない」と書いて parity の対象外にする。(3) leanFetch.test.ts に「abort 済み Request は CLI に届かず状態も変えない」を 1 本足す。
- Cradle の規則: 生成クライアントに差し込むカスタム fetch（dev 専用のドメイン実装アダプタを含む）は `Request.signal` を必ず尊重する。e2e を dev サーバ（StrictMode 有効）に対して回すときは、二重マウントが dev 固有であることを明記し、必要なら StrictMode を切る環境変数を用意して「テストが本番に無い挙動を安定化させている」状態を作らない。

### [Medium] `allowedOn` は Lean validate の手書き複製（13 述語）で、golden の拒否と突き合わせるテストが無い

- 場所: `monowa/frontend/src/lib/visible.ts:70`（drift）
- 根拠: visible.ts:15-29 の対応表は各 `UseCase.lean` の validate を人手で写したもの。:79-83「`originKind` が `null` のときは取り消せる側に倒す — `CancelHandUseCase.validate` が `find? = none` を `.ok` にしているのと同じ」（CancelHandUseCase/UseCase.lean:51-53 の `| none => .ok l` の複製）。:88-90 `remind: lender && lent && loan.overdue` / `askEarlyReturn: lender && lent && !loan.overdue`（RemindUseCase/UseCase.lean:37 `isOverdue today`）。test/golden.ts:100-107 `refusalAt`「押しても…
- なぜ問題か: 「業務としてできない操作は出さない」を画面で実現する限り、validate の複製は避けられない。それ自体は README が認めた方針だが、複製が正しいことを機械で確かめる仕組みが無い: Lean 側で validate の条件を 1 つ変えても、visible.ts は型で落ちず、App.test.tsx は変えた条件を知らない。golden には「この viewer がこの手を打つと selfRaiseHand / notBorrower / notOverdue / notLender で断られる」が 14 段中 5 段記録されており、そこから「同じ viewer の画面にそのボタンが無い」を自動で導けるのに使っていない。
- 直し方: 短期: golden の各 trace について「拒否された手 ⇒ その actor の画面に対応ボタンが無い」「通った手 ⇒ ボタンがある」を `refusalAt` / `rawViewsAfter` で機械的に回すテストを 1 本置く（actor は trace のコマンドの actor から取る）。中期: Lean の View に `can: { handOver, confirmReturn, … }` のような許可ビットを載せて契約に写し、visible.ts を「View の事実の読み取り」だけに戻す（README の境目「View に無い事実を画面で導出しない」に完全に沿う）。
- Cradle の規則: UI が「できない操作を出さない」ために仕様の validate を写すなら、(a) 仕様側 View に許可ビットを載せて写しを無くすか、(b) 写しを golden の拒否記録と突き合わせるテストで固定する。写しの数を規約で上限管理せず、検証手段の有無で管理する。

### [Medium] `lib/milestones.ts` 冒頭コメントが現在の方針と正反対（「どのボタンも消えず無効にもならない」）

- 場所: `monowa/frontend/src/lib/milestones.ts:6`（drift）
- 根拠: milestones.ts:6-8 「段階でボタンを隠す・無効にすると、Lean の validate を TypeScript に再実装することになる。操作は常に全部出し、拒否はモデルが返した理由をその場に出す。…どのボタンも消えず無効にもならない。」一方 README.md:139-141「**業務としてできない操作は出さない。** 立場でも段階でも同じ（2026-08-21 のレビュー指摘）」、visible.ts:3-5「Lean の validate のうち…判定できる部分の写し」、LoanSheet.tsx:60 `const progress = PROGRESS.filter((entry) => allowed[entry.tag])`。git log: 320f98f「できない操作を出さない」で方針が反転。
- なぜ問題か: 根拠として書かれたコメントは次の実装者の判断材料になる。ここを読んだ AI/人は「隠すのは禁止」と受け取り、visible.ts を撤去する方向に動きかねない（documents/ai-notes/20260821-02 の B 節と同じ種類の事故 — 古い根拠コメントが 4 か所あった）。
- 直し方: milestones.ts の冒頭を「出す・出さないは visible.ts、ここは強調だけ」に書き換え、反転した決定（2026-08-21）へのポインタを付ける。方針を反転させたコミットでは、旧方針を根拠に書いたコメントを grep（例: 「全部出し」「隠さない」）して同時に直す手順を README/CLAUDE.md に足す。
- Cradle の規則: 設計方針を反転させたときは、旧方針を根拠として引いているコード内コメントを grep して同じコミットで直す。根拠を書くコメントには決定の日付/記録へのポインタを付け、方針そのものをコメントに再掲しない。

### [Medium] `useRelationships` があらゆる失敗と pending を `null`（＝「見られない」）に潰す

- 場所: `monowa/frontend/src/state/boards.ts:55`（error-handling）
- 根拠: boards.ts:46-56 「`null` は「見られない」で、`[]` は「つながりが無い」」`return query.data ?? null` — error の code を見ていない。RelationshipRing.tsx:45 `const refused = relationships === null` / :83-91 「この一覧は見られません…上位陣だけです」。Spine.tsx:48 `const canSeeRelationships = useRelationships() !== null`。App.test.tsx:118-120 は入口の出現を `waitFor` で待っており、読み込み中は入口が消えている。
- なぜ問題か: 関係性だけ 500 やネットワーク断になった上位陣には「上位陣だけです」と身に覚えの無い拒否が出る。README が細かく区別してきた「見られない／無い／届かない」の三つ組のうち、この口だけ「届かない」が「見られない」に化ける。契約は 403 の code を `noActor | notLeadership` と明示している（openapi.yaml:866-878）ので、分岐材料はある。
- 直し方: `failureOf(query.error)?.code === 'notLeadership'` のときだけ null、それ以外の error は gate と同じ unreachable 扱い（`useBoardGate` に含める）、pending は `undefined` として入口を「まだ分からない」に留める（3 値にする）。
- Cradle の規則: 「拒否」を表す null / 空は、契約の特定 code にだけ写す。error 全般や pending を同じ値に畳まない — 読み込み中・不達・拒否は型の上で別の値にする。

### [Medium] dev の世界（Lean state）が閉包の `snapshot` 優先で、複数タブ（貸す側／借りる側を並べる最も普通の使い方）で互いを上書きする

- 場所: `monowa/frontend/src/api/lean/leanFetch.ts:239`（persistence）
- 根拠: leanFetch.ts:238-239 「閉包にも置くのは storage を往復しないため（正は storage 側）」`let snapshot: unknown = keptWorld()` — 以後 :245 `call({ cmd: 'views', state: snapshot, …})` と :302 `call({ cmd: 'step', state: snapshot, …})` は storage を読み直さず、:248/:304 `keepWorld(snapshot)` で上書きする。README.md:97-100 は「貸す側と借りる側が代わりばんこに操作する…このドメインで最も普通の筋」のために localStorage に置いたと説明。
- なぜ問題か: README の想定は「同じタブでサインアウト→サインイン」だが、開発者は普通に 2 タブ（社員 01 と 02）を開く。タブ A が step した世界はタブ B の閉包に届かず、B の次の step が A の変更を消す。dev で「モデルが正しいかを人間が画面で確かめる」（README「なぜ dev の相手が Lean CLI なのか」）という中核の作業で、モデルのせいではない消失が起き、原因が分かりにくい。
- 直し方: 各リクエストの先頭で `keptWorld()` を読み直して `snapshot` を更新する（`storage` イベントでも可）。並行 step を避けたいなら、localStorage に世代番号を持ち、書く前に読んだ世代と一致しなければ `views` で映し直してから step する。README に「複数タブは非対応」なら明記する。
- Cradle の規則: dev 専用のブラウザ内ドメイン実装が状態を持つときは、storage を唯一の正として毎リクエスト読み直す（閉包キャッシュを正にしない）。複数タブでの並行操作を想定するか非対応かを README に明記し、想定するなら世代番号で衝突を検知する。

### [Medium] コマンド後の遷移先を画面がモデルの遷移規則を再導出して決めている（`joinsLine` = `waitsInLine` の写し、confirmReturn → closed）

- 場所: `monowa/frontend/src/lib/visible.ts:40`（drift）
- 根拠: visible.ts:33-42 「`RaiseHandUseCase.waitsInLine` の写しで…行き先の判断」`return intent.engaged || intent.waiting.length > 0` — lean/MonoWa/Application/UseCase/RaiseHandUseCase/UseCase.lean:81-83 `waitsInLine … := before.loans.engaged target.id || !target.waiting.isEmpty` の複製。IntentSlip.tsx:86 `if (applied) navigate({ screen: joinsLine(intent) ? 'line' : 'loans' })`。LoanSheet.tsx:108 `if (applied && entry.tag === 'confirmReturn'…
- なぜ問題か: README「ドメインの判断を画面に書かない」の境目は「View が運ぶ事実に限る」だが、ここは事実の読み取りではなく **状態遷移の予測**を画面が持っている。モデル側で waitsInLine の条件が変わる（例: 列が満杯なら断る、貸出中でも即成立する origin が増える）と、Lean も契約も型は変わらず画面だけが別の画面へ連れて行く。ボタンを隠す `allowedOn` は「押しても拒否される」だけで済むが、遷移の誤りは利用者に「何が起きたか分からない」を残す。
- 直し方: コマンドの応答か読み直した View から行き先を決める: 204 のあと invalidate 済みの `myLine` に `intent.id` があれば line、`loans` に origin.intent === id の一件があれば loans、と **結果の事実**で選ぶ。あるいは契約の POST 応答に `Location` / 成立した資源 id を載せる（Lean の act は Loan か列かを返している）。confirmReturn の遷移も「closedLoans に id が現れたら」で決める。
- Cradle の規則: コマンド後の画面遷移は、モデルの遷移規則を UI に写して予測せず、応答（Location / 返された id）か読み直した View に現れた事実で決める。UI に置いてよい「写し」は View の事実の読み取りまでで、状態遷移の再実装は禁止。

### [Medium] テストコードが `pnpm typecheck` の対象になっていない疑い（README と convert.test.ts の記述が矛盾、test の tsbuildinfo が無い）

- 場所: `monowa/frontend/tsconfig.test.json:9`（config）
- 根拠: README.md:106「`pnpm typecheck` 型検査だけ（app / node / test の 3 プロジェクト）」。一方 convert.test.ts:22「テストは tsc の検査対象外（tsconfig.test.json の既知の空振り）」。`ls node_modules/.tmp/` には `tsconfig.app.tsbuildinfo` と `tsconfig.node.tsbuildinfo` のみで `tsconfig.test.tsbuildinfo` が無い（tsconfig.test.json:4 は `./node_modules/.tmp/tsconfig.test.tsbuildinfo` を指定）。tsconfig.test.json:9 `"references": [{ "path": "./tsconfig.app.json" }]` だが tsconfig.app.…
- なぜ問題か: golden 再生テストや stubApi は「契約が変われば型で落ちる」ことを前提に設計されている（README「詰め替えの型は生成型で」）。テスト側が型検査から外れていると、`pnpm gen:api` 後にテストが古い形のまま vitest（esbuild、型検査なし）で走り、`as` キャストの多い箇所（leanFetch.test.ts:48-49 `as LeanResponse`、App.test.tsx:100）で沈黙する。README の主張と実態が食い違うこと自体が drift。
- 直し方: `tsc -p tsconfig.test.json --noEmit` を `typecheck` に明示的に足す（`-b` の references に頼らない）か、app を `composite: true` にして参照を成立させる。どちらにせよ convert.test.ts:22 のコメントと README.md:106 を実態に合わせる。CI でテストの型検査が走った証跡（tsbuildinfo か明示コマンド）を残す。
- Cradle の規則: テストコードも型検査の対象に入れ、`tsc -b` の project references に頼らず明示コマンドで CI に載せる。「テストは型検査外」と決めるなら README にそう書き、逆の記述を残さない。

### [Medium] 拒否語彙 `REFUSALS` が手書きで、契約の各 operation の 4xx code を網羅している保証が無い

- 場所: `monowa/frontend/src/api/errors.ts:24`（error-handling）
- 根拠: errors.ts:24-55 `export const REFUSALS = [ 'unknownIntent', … ] as const satisfies readonly ErrorCode[]` — `satisfies` は REFUSALS ⊆ ErrorCode しか検査しない。useAct.ts:37-41 `if (failure !== null && isRefusal(failure.code)) { announce('refused', …) } else { announce('trouble', `モデルに届きませんでした…`) }`。openapi.yaml:1128-1150 の 422 群と REFUSALS を目視で突き合わせると現時点では一致するが、それを検査するテストは無い（`grep REFUSALS src` は errors.ts と labels.ts のみ）。
- なぜ問題か: 契約に 422 の code が 1 つ増えたとき、`pnpm gen:api` は ErrorCode を広げるだけでコンパイルは通る。画面はその拒否を「届きませんでした（…）」と設備の不調として出し、板は変わらないのに理由も出ない。README が約束する「拒否はその理由をそのまま出す」が黙って破れるが、型でもテストでも気づけない。
- 直し方: openapi.yaml の各 operation の 403/404/422 応答 `code.enum` を集めて REFUSALS と一致することを確かめるテストを convert.test.ts と同じ要領で置く（yaml を読み、境界語彙 6 つと閲覧拒否 2 つを除いた集合 == REFUSALS）。将来的には REFUSALS 自体を生成する。
- Cradle の規則: 契約由来の語彙（エラー code・enum）を UI 側で手書きの部分集合として持つときは、「契約 ⊇ 手書き」だけでなく「契約の該当集合 == 手書き」をテストで固定するか、生成に切り替える。

### [Low] 400/500 も「モデルに届きませんでした」と言い、契約外の本文（プロキシの HTML 等）をそのまま通知に出す

- 場所: `monowa/frontend/src/state/useAct.ts:41`（error-handling）
- 根拠: useAct.ts:41 `announce('trouble', `モデルに届きませんでした（${detailOf(cause)}）`, path)` — 拒否語彙以外は 400 badRequest / 500 internalError / 401 も同じ文面。errors.ts:75-79 `detailOf` は `failureOf` が読めなければ `String(error)` を返すので、nginx の 502 HTML がそのまま通知本文になる。Notice.tsx:21 `trouble: { title: '届きませんでした' }`。
- なぜ問題か: 500 は「届いたうえで壊れた」、400 は「画面の組み立てが間違っている」であり、どちらも利用者への言い分は「届かなかった」ではない。特に 400 は README が「形・構築の誤り（400 の側）」と分けている画面側のバグなので、開発中に見落とす。
- 直し方: `failureOf` が読めたら code で 3 分岐（badRequest→「画面の不具合」、internalError→「相手側の不具合」、その他境界→「届かなかった」）、読めなければ本文は捨てて status だけ出す。
- Cradle の規則: 「届かなかった」「相手が壊れた」「こちらの組み立てが誤っている」は利用者向け文言でも分け、契約外の応答本文（HTML 等）をそのまま画面に出さない。

### [Low] ID トークンのクレーム読み取りが session.ts と leanFetch.ts で二重に実装されている

- 場所: `monowa/frontend/src/api/lean/leanFetch.ts:68`（slop）
- 根拠: leanFetch.ts:68-76 `const numberClaim = (claims, name) => { … }` と :83-100（`split('.')[1]` → `atob` → `custom:employeeId` / `cognito:groups`）は session.ts:58-77 / :83-95 と同じ処理の複製。
- なぜ問題か: クレーム名（`custom:employeeId`、`monowa-steward`）は INFRA-D-016 で決まる 1 つの事実。2 か所にあると片方だけ変えて dev（Lean）と本番（REST）の名義の読み方がずれる — README が最も避けたい「dev と本番で画面に別のものが映る」の入口になる。
- 直し方: `auth/session.ts` に `claimsOf(token): Session | null`（トークン文字列を受ける純関数）を export し、leanFetch はそれを使う。
- Cradle の規則: 認証クレームの解釈（名前・型・グループ）は 1 関数に閉じ、dev 専用アダプタも同じ関数を使う。

### [Low] `SignUpDriver` の effect 依存に毎レンダ新しくなる `useAct` の返り値が入っている

- 場所: `monowa/frontend/src/state/MonoWaProvider.tsx:231`（slop）
- 根拠: MonoWaProvider.tsx:227-231 `useEffect(() => { … void startUsing.run({}).finally(settleSignUp) }, [signingUp, actor, startUsing, settleSignUp])` — useAct.ts:51 `return { busy: mutation.isPending, run }` は毎レンダ新オブジェクト（`run` も未 memo）。:225 `startedRef` で二重送信は防いでいる。
- なぜ問題か: 実害は ref で止まっているが、effect が毎レンダ走る構造は StrictMode 二重実行と合わせて読み手を迷わせる。exhaustive-deps を満たすために不安定な値を入れるのは、hook の返り値を安定化しないことの症状。
- 直し方: `useAct` の `run` を `useCallback` で、返り値を `useMemo` で安定化する。
- Cradle の規則: カスタム hook が返す関数/オブジェクトは安定化（useCallback/useMemo）し、effect の依存に入れても毎レンダ再実行されないようにする。

### [Low] アクセシビリティ: ハッシュ遷移を `<button>` で行い、遷移後のフォーカス移動が無い。非対話 span への aria-label、hover のみの強調

- 場所: `monowa/frontend/src/components/Spine.tsx:30`（a11y）
- 根拠: Spine.tsx:30-41 `<button … aria-current={here ? 'page' : undefined} onClick={() => navigate(to)}>` — 画面は URL（`#/loans` 等）で表せるのに link ではない。IntentSlip.tsx:86 / LoanSheet.tsx:108 の `navigate(...)` 後にフォーカスも見出しへの移動も無い。LoanSheet.tsx:70 `<span className="sheet__arrow" aria-label="が貸す相手">——▶</span>`（role の無い span の aria-label は多くの支援技術で読まれない）。RelationshipRing.tsx:149-154 `onMouseEnter` / `onMouseLeave` のみでキーボードの焦点が無い（:156 コメン…
- なぜ問題か: jsx-a11y ルールと focus-visible / reduced-motion / visually-hidden / `lang="ja"` は整っており基礎は良い。残るのは「URL がある画面遷移はリンク」「遷移したら見出しへフォーカス」という SPA の定番で、スクリーンリーダー利用者には遷移が伝わらない。
- 直し方: Spine の Tab を `<a href={hashOf(to)} aria-current="page">` にし、`navigate` 後に `main` の見出しへ `focus()`（`tabIndex={-1}`）。矢印は `<span role="img" aria-label>` か可視文言にする。busy 中は `aria-busy` + `aria-disabled` にして disabled でフォーカスを飛ばさない。
- Cradle の規則: URL で表せる画面遷移はリンク要素で行い、遷移後は主見出しへフォーカスを移す。非対話要素に aria-label を付けない（role を与えるか可視文言にする）。送信中のボタンは disabled ではなく aria-busy/aria-disabled で止める。

### [Low] 本番の利用者向け文言に dev の構成（Lean CLI）が漏れている

- 場所: `monowa/frontend/src/App.tsx:81`（slop）
- 根拠: App.tsx:80-83 「MonoWa の画面はドメインモデルに直接つながっています。相手（Lean CLI か backend の REST）が動いていないと、この板には何も出せません。」— dist にも入る文面。
- なぜ問題か: 配られた画面で設備障害が起きたとき、社員は「Lean CLI」という語を見る。README が「dist に Lean 側は 1 バイトも入らない」と誇る一方で語彙は入っている。
- 直し方: 文面から構成の話を落とし、dev 向けの説明は `import.meta.env.DEV` のときだけ追記する。
- Cradle の規則: 利用者向け文言に開発時の相手（モック・CLI・スタブ）の名前を出さない。dev 限定の説明は DEV 分岐で足す。

### [Low] 社内ツールの index.html が Google Fonts（外部オリジン）に依存している

- 場所: `monowa/frontend/index.html:13`（infra）
- 根拠: index.html:13-18 `<link rel="preconnect" href="https://fonts.googleapis.com" />` … `<link href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic…" rel="stylesheet" />`。README.md:250-251「Web フォントは Google Fonts から読む…届かない環境ではヒラギノに落ちる」。
- なぜ問題か: 全社員が使う社内板が第三者オリジンへ毎回リクエストを出す（利用者 IP の送信、CSP を締められない、社内ネットワークで遮断されると初回描画が遅れる）。フォールバックは用意されているが、CloudFront/nginx に CSP を足す設計と両立しにくい。
- 直し方: フォントを自前で配信（`public/fonts` + `@font-face`、unicode-range 分割はビルドで生成）するか、README にプライバシー/CSP 上の判断として明記する。
- Cradle の規則: 配布物の実行時外部依存（フォント・CDN・解析）は既定で持たず、持つなら README に理由と CSP 方針を書く。

#### そのまま持ち込んでよい良い実践

- 外と話す口が生成クライアント 1 枚（openapi-fetch + `src/api/generated/schema.d.ts`）に統一され、手書きの包みが無い。`src/api/types.ts:33-35` の `CommandPath` は `paths` から POST を持つパスを導出するので、契約から消えた口は型で呼べなくなる（`useAct<P extends ActPath>`）。生成物を git に入れて `pnpm typecheck` がネットワーク無しで通る運用も妥当。
- dev 専用のドメイン実装アダプタ（`src/api/lean/leanFetch.ts`）を `import.meta.env.DEV && transportName() === 'lean'` の分岐＋動的 import（`src/api/index.ts:50-56`）の後ろに置き、配布物に 1 バイトも入れない設計。同じ `createClient<paths>({ fetch })` に差すだけなので画面側のコードは相手を知らない。
- テストの材料を手書きせず、モデルが吐いた `lean/golden/<name>-{init,flow}.json` を dev と同じ詰め替え（`convert.ts`）で契約の形に射影して使う（`src/test/golden.ts`）。未登録の束を板がある前提のテストに食わせたら投げる（golden.ts:36-40）など「黙って埋めない」が徹底されている。
- `convert.test.ts` の golden 再生 × openapi.yaml スキーマ検証（Ajv 2020-12、`$ref: monowa#/components/schemas/…`）と、`seen > 0` で「検証ゼロを緑にしない」ガード。backend の契約テストと同じ golden にピン留めするので、Lean / REST / 画面が同じ源に縛られる。
- `src/test/stubApi.ts` はドメインを再実装せず、受けた呼び出しを控えて決めた返事を返すだけ。`App.test.tsx:62-63` は「名義が path にも body にも現れない（Authorization だけ）」を事実として検査している。
- 失敗の扱い: 分岐は `code` だけ（`message` は表示にも分岐にも使わない、文言は `lib/labels.ts` の表が正）。業務の拒否（REFUSALS）と境界の語彙を `src/api/errors.ts` で分け、拒否のときは板を読み直さない（世界は変わっていない）。`Notice` は通ったときも黙らず、`role="status"` + `key={seq}` で同文面の再読み上げに対応し、`NOTICE_LIFE` で居座らせない。
- 認証: 認可コード + PKCE（S256、32 byte verifier、state 検証）。トークンは sessionStorage（人が替わる）、dev の世界は localStorage（世界は続く）という storage の使い分けがドメインの説明と対応している。`completeSignIn` を描画前に 1 回だけ await し、失敗は投げずに幕へ出す。クレームに社員番号が無いとき `employeeId: null` を保ち「サインインしていない」と混ぜない（でっち上げない）。Bearer はミドルウェアでのみ付け、本文・クエリに入れない。
- 幕の三分法: SignInCurtain（未サインイン）／NotAnEmployeeCurtain（名義になれない）／NotStartedCurtain（`notMember` = そこに無い）／Unreachable（設備）を分け、`useBoardGate` が `notMember` を不達と言い分ける。関係性の `null`（見られない）と `[]`（無い）を分け、URL 直叩きでも空として描かない（`App.test.tsx:123-129`）。
- 利用者が明示的に求めた絞り込みは「伏せた件数を出す」「解除の導線を置く」を守っている（`IntentBoard.tsx:89-105`）。板の並び・件数はモデルの結果をそのまま使い、`Spine` の件数バッジは撤去済み。
- 操作中の停止は押したボタンだけ（`Act` の `busy`、mutation はコンポーネントごと）。TanStack Query は `retry: false` / `refetchOnWindowFocus: false` / `staleTime: Infinity` で、裏で勝手に読み直さず「届かないなら届かないと言う」方針が設定に出ている。コマンドが通ったら invalidate → 読み直しを待ってから「できました」と言う。
- 暦: `lib/calendar.ts` は日付の実在判定をせず ISO 文字列をそのまま送り、境界（Lean の PlainDate）に判断を残す。`new Date()` のローカル解釈を使わない。
- TS/lint の締め方: `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `erasableSyntaxOnly` + `noUncheckedSideEffectImports`。oxlint に `jsx-a11y`（label-has-associated-control / aria-props / role-has-required-aria-props）と `typescript/no-explicit-any: error`。CSS に `:focus-visible`、`prefers-reduced-motion`、`.visually-hidden`、`index.html` に `lang="ja"` と `color-scheme`。
- 画面の状態は「どの画面か・誰か・直前の返事」だけで、ドメイン状態を React に持たない（板は Query キャッシュ、Lean の `state` は leanFetch の外に出さない）。URL（hash）は画面だけを表し板の中身を載せない。
- コード内コメントが「なぜ」を決定記録（HS-xxx / INFRA-D-xxx / 日付）で引く習慣があり、`documents/ai-notes/` は「規約ではない」と冒頭で明示している。

## インフラ・E2E

### [High] CI/CD が存在せず、本番イメージが開発者端末でリポジトリ外の依存を使って焼かれる（再現性・供給網）

- 場所: `monowa/documents/infra-design/04_operations.md:35`（infra）
- 根拠: リポジトリに `.github/workflows` 等の CI 定義が無い（find で該当なし）。04_operations.md:35-38「`compileKotlin` が `lake` とリポジトリ外の lean2kotlin プラグイン（`../../lean2kotlin/lean`）に依存するため … CI を組むときは … （INFRA-Q-006）」。infra/README.md:182-186 で `docker buildx build --platform linux/arm64 … --push` を手元で実行する手順。backend/Dockerfile:34 `ARG JAR_FILE=build/libs/*.jar`（ホストビルド済み jar を包むだけ）。documents/infra-design/README.md の INFRA-Q-006「変わらず」。03_aws-product…
- なぜ問題か: Lean の #guard、lean2kotlin 生成、契約テスト、`terraform validate`、e2e のどれも自動では回らない。本番イメージの入力（jar）がどのコミットの Lean・どの版の lean2kotlin から作られたかを後から確定できず、ECR の immutable タグで守ろうとしている「何が動いているか」の保証が入口で崩れる。加えて本番スタック全体が一度も apply されておらず、apply 時にしか出ない誤りが未検出。
- 直し方: (1) lean2kotlin を git submodule か固定コミットの依存として repo 内に固定し、Lean ツールチェーン + JDK + lean2kotlin を含む builder イメージを用意して、jar もコンテナ内で再現ビルドできるようにする。(2) CI で `lake build` → `./gradlew build`（契約テスト含む）→ `terraform fmt/validate` → イメージビルド/push（SHA タグ）→ `terraform plan` を回す。(3) サンドボックス AWS アカウントで一度 apply し、初回手順（ECR 先行・callback URL の 2 往復）を検証する。
- Cradle の規則: 「生成物を包むだけの Dockerfile」を許すのは、生成物の入力（ツールチェーン・外部リポジトリ）がすべて固定コミットで repo から辿れる場合に限る。Cradle は builder イメージと最小 CI（spec build → codegen → contract test → IaC validate → image build）を最初からテンプレートに含める。

### [High] e2e が「順番待ちからの自動番回し（nextInLine / TurnPassing）」を一度も辿っていない

- 場所: `monowa/e2e/src/model/flows.ts:106`（e2e）
- 根拠: flows.ts:106-146 `queue-and-give-up` は bunta/dan が列に並ぶが両者とも「やめる」で抜け、先頭の一件は終わらない。flows.ts:187-209 `call-off` は待ち手が居ない状態で中止する。他の 13 本にも、進行中の一件が終わって次の順番待ちに番が回る手は無い。一方 lean/golden/call-off-flow.json は trace #1 で chiaki が列に並び、#3 で loan 0 を callOff した後 #4 で **loan id 1**（chiaki が nextInLine で成立した一件）を callOff しており、番回しを golden で確かめている。frontend/src/lib/labels.ts:54 に `nextInLine: '順番待ちから番が回って成立'` の表示がある。
- なぜ問題か: 番回しは「返却の確認・やめる・中止と同じトランザクションの中の帰結（DomainService TurnPassing）」で、REST 実装がトランザクション境界を跨ぐ横断処理として最も壊れやすい箇所。Lean と REST の画面挙動を突き合わせる e2e の目的からすると、ここが空白なのは網羅表の見た目以上に重い。
- 直し方: `call-off` か `raise-hand-happy-path-to-closed` に 2 人目の raiseHand を挟み、先頭の一件が終わった直後に `loans` 画面で次の当事者の紙面（origin ラベル「順番待ちから番が回って成立」）と `line` 画面からの消失を観測する手を足す。可能なら golden の call-off-flow をそのまま写す（下記「golden から生成」の所見）。
- Cradle の規則: e2e/パリティテストの網羅は「画面の操作一覧」ではなく「モデルの DomainService・横断不変条件の一覧」から逆引きして決める。トランザクション内の派生更新（自動遷移）は必ず 1 本以上のフローで観測する。

### [High] 既定の apply で CloudFront→ALB が平文になり、Authorization ヘッダ（ID トークン）がその区間で裸になる（fail-open な既定値）

- 場所: `monowa/infra/envs/prod/variables.tf:95`（security）
- 根拠: infra/envs/prod/variables.tf:89-96 `variable "alb_certificate_arn" … 空だと CloudFront → ALB が平文になる … default = ""`。infra/modules/backend-service/alb.tf:104-106 `origin_protocol = var.certificate_arn == "" ? "http-only" : "https-only"`、同 29-36 で CloudFront prefix list から 80 を常時許可。documents/infra-design/03_aws-production.md:247-251「CloudFront → ALB が平文だと `Authorization` ヘッダ（= 有効なトークン）がその区間で平文になる」。
- なぜ問題か: 設計側は危険性を認識して INFRA-Q-004 に起票しているが、Terraform の既定値は「何も指定しなければ平文」で apply が成功してしまう。有効な ID トークンが AWS バックボーン上とはいえ平文で流れる構成が、意図せず本番として成立しうる。
- 直し方: `alb_certificate_arn` の default を外して必須にするか、`variable validation`/`precondition` で「`aliases` が空でも ALB 用証明書は必須」を強制する（ALB は `*.elb.amazonaws.com` 用 ACM が取れないので、独自ドメインを先に決める判断を強いる形になるが、それが正しい順序）。暫定的に平文を許すなら `allow_plaintext_origin = true` のような明示のオプトインにする。
- Cradle の規則: セキュリティに関わる Terraform 変数は fail-closed の既定にする。「空なら安全側に倒れる」ではなく「空なら apply が止まる」を validation/precondition で表現し、緩和は明示のオプトイン変数でしか行えないようにする。

### [High] 空 DB への同時起動でスキーマ初期化が競合する（INFRA-Q-007 未決のまま本番前提が desired_count=2）

- 場所: `monowa/backend/src/main/resources/application.yml:12`（reliability）
- 根拠: application.yml:10-13 `sql: init: mode: always / schema-locations: classpath:db/schema.sql`（全プロファイル共通）。infra/envs/prod/variables.tf:35-39 `desired_count` default 2。documents/infra-design/04_operations.md:83-96「まっさらな DB に backend を 3 タスク同時起動したところ、2 タスクが起動に失敗した … duplicate key value violates unique constraint "pg_type_typname_nsp_index"」、同 108-117「INFRA-Q-007・未決 … 本番を作る前にどれかに決めること」。
- なぜ問題か: 初回デプロイと空 DB への復旧直後という「一番失敗してほしくない瞬間」に、ECS のサーキットブレーカが理由の分かりにくいロールバックを起こしうる。さらに稼働中 DB へのスキーマ変更手段（マイグレーション）が無いため、`schema.sql` 1 本の運用は最初の 1 回しか通用しない。実測で壊れることが分かっているのに設計上の決着が先送りされている。
- 直し方: アプリ起動時 DDL を止め、Flyway/Liquibase など「ロックを取り・履歴を持つ」マイグレーション実行を独立した step（CI のデプロイジョブ、または ECS の one-off タスク）にする。jOOQ の生成元は引き続き migration ディレクトリから DDLDatabase で読めば「正本 1 本」の規約は保てる。移行までの暫定としては `spring.sql.init` を local/test 限定にし、prod は `never`、初回のみ `desired_count=1` で立ててから 2 に上げる手順を README に明記する。
- Cradle の規則: スキーマ適用はアプリ起動の副作用にしない。ロック付き・履歴付きのマイグレーション step をアプリ起動と分離し、複数レプリカ同時起動を前提に設計する。Cradle は最初から migration ツール（Flyway 等）と「空 DB へのマルチレプリカ起動」を CI で再現するスモークをテンプレート化する。

### [Medium] Cognito ユーザープールに削除保護・prevent_destroy が無い（利用者の同一性の器が Terraform の一手で消える）

- 場所: `monowa/infra/modules/identity/main.tf:27`（security）
- 根拠: identity/main.tf:27-74 `aws_cognito_user_pool` に `deletion_protection` も `lifecycle { prevent_destroy }` も無い。対照的に database/main.tf:120 は `deletion_protection`、bootstrap/main.tf:51-53 は `prevent_destroy` を置いている。`mfa_configuration` も未設定（既定 OFF）。
- なぜ問題か: ユーザープールは組織図由来の属性（`custom:employeeId`）を持つ唯一の場所で、消えると再投入の経路が INFRA-Q-005 のとおり未決。プール ID が変われば `issuer` も変わり backend と画面の焼き込みも全部やり直しになる。RDS に付けている保護と同じ水準が要る。
- 直し方: `deletion_protection = "ACTIVE"` と `lifecycle { prevent_destroy = true }` を付ける。社内利用でも `mfa_configuration = "OPTIONAL"` + `software_token_mfa_configuration` を検討する。
- Cradle の規則: 再作成コストが高い・状態を持つリソース（DB・IdP・state バケット）は一律で削除保護 + prevent_destroy を付ける。保護の有無をリソース種別ごとに揃える。

### [Medium] backend コンテナを作り直すと nginx が古い upstream を掴み、手動 `docker restart` が手順に埋め込まれている

- 場所: `monowa/infra/envs/local/main.tf:330`（infra）
- 根拠: main.tf:310-331 `docker_container.frontend` は `depends_on = [docker_container.backend]` のみで、backend の再作成では作り直されない。frontend/nginx/default.conf.template:20-21 `proxy_pass ${BACKEND_ORIGIN}`（起動時に名前解決が固定される）。documents/infra-design/02_local.md:221-223「backend コンテナを作り直すと、nginx が古い接続先を掴んだままになる … `docker restart` すること — でないと `/api/*` が原因不明の `405` を返す」。infra/README.md:141-144、e2e/README.md:135,142 で毎回 `docker restart monowa-l…
- なぜ問題か: `var.faketime` の切り替えや jar の差し替えのたびに人手の一手が要り、忘れると症状（405）が原因と結びつかない。ai-notes の実測どおり「古いコンテナ」問題の温床でもある。
- 直し方: `docker_container.frontend` に `lifecycle { replace_triggered_by = [docker_container.backend.id] }` を足して backend と一緒に作り直す。あわせて nginx 側で `resolver 127.0.0.11 valid=10s;` + `set $upstream ${BACKEND_ORIGIN}; proxy_pass $upstream;` の形にして再解決させれば、どちらか一方でも足りる。
- Cradle の規則: ローカルのリバースプロキシは upstream を動的に再解決させるか、IaC で upstream コンテナの差し替えに連動して作り直す。「〜のたびに restart せよ」という手順が README に載った時点で IaC の欠陥とみなす。

### [Medium] e2e が開発ループと共有する同じ PostgreSQL を TRUNCATE する（分離されたテスト用 DB が無い）

- 場所: `monowa/e2e/src/support/db.ts:24`（e2e）
- 根拠: db.ts:24-27 `TRUNCATE TABLE loan_remark, intent_waiting, loan, intent` / `ALTER SEQUENCE … RESTART` / `DELETE FROM employee WHERE id > 4`。config.ts:38-44 の既定は `localhost:5432` / `monowa` — infra/envs/local/variables.tf:44-52 で「ホストで ./gradlew bootRun する使い方でも同じ DB を向ける」と説明される共有 DB と同一。playwright.config.ts:180-183 `workers: 1 / fullyParallel: false` はこの共有を前提にした直列化。e2e/README.md:73-74。
- なぜ問題か: 開発者がフルスタックで手で試している最中に `pnpm test` を走らせると、その盤面が黙って消える。並列実行も不可能で、フロー数が増えるほど実行時間が線形に伸びる。CI で回すときにも共有前提が足を引っ張る。
- 直し方: e2e 専用のスタックを `terraform apply -var name=monowa-e2e -var db_port=5433 …`（別 network/volume/ポート）で立てるか、少なくとも e2e 専用 database を同じ postgres に作り `SPRING_DATASOURCE_URL` を切り替えた backend コンテナを別名で立てる。将来はフローごとに schema/DB を分ければ `workers` を上げられる。
- Cradle の規則: e2e は自分専用の使い捨てデータストアを前提にし、開発者の作業用インスタンスに破壊的操作をしない。`workers: 1` は「並列化できない理由」を解消するまでの暫定であり、その理由（共有 DB）を設計で消す。

### [Medium] e2e の前提サービス 3 系統を手で起動する必要があり、単一コマンドで再現できない（CI 不能）

- 場所: `monowa/e2e/playwright.config.ts:178`（e2e）
- 根拠: playwright.config.ts:176-178「対象のサービス(pnpm dev・Lean CLI・terraform local env)はこの設定からは起動しない」。e2e/README.md:9-15 で `terraform apply` / `lake build && node mockup/server.mjs` / `pnpm dev` の 3 つを別ターミナルで起動する手順。documents/ai-notes/20260902-01-e2e-lean-rest-parity-tool.md:64-86「コンテナが 2026-08-21 ビルドのまま … 14 本中 12 本が REST 相手に落ち続け」。
- なぜ問題か: 人手の起動順序と鮮度に依存するため、実測どおり「古いコンテナのまま走って原因不明の差分」が起き、CI に載せられない。パリティテストは backend 改修の締め（CLAUDE.md:300-306）と位置づけられているのに、自動で回る形になっていない。
- 直し方: `playwright.config.ts` の `webServer` 配列（`lake build && node mockup/server.mjs`、`pnpm dev`、`terraform apply` を包む `scripts/up.sh`）で起動を一元化し、`reuseExistingServer` で手元の起動も許す。起動スクリプトは `docker inspect --format '{{.Created}}'` と `git log -1 --format=%ci` の比較、または `terraform plan -detailed-exitcode` で古いイメージを検出して止める。
- Cradle の規則: e2e は「1 コマンドで前提を立て、古い成果物を検出して止める」形にする。前提サービスの起動を README の手順に委ねない。

### [Medium] e2e フローは Lean golden trace と重複する手書きカタログで、golden から機械生成できる構造になっている

- 場所: `monowa/e2e/src/model/flows.ts:30`（e2e）
- 根拠: flows.ts:30-503 に 15 本を手書き。lean/golden/*-flow.json の各要素は `actor`（employee.id / department.id / steward）・`command`（例 `{"raiseHand":{"intent":{"id":0}}}`）・成功時 `state`+`views`／失敗時 `domainError` を持つ（lean/Main.lean:14-15,139-154）。直前要素の `state.intents[id].item.label / owner` と `state.loans[id].item.label / lender / borrower` から品目ラベルと当事者が解決でき、e2e の StepIntent（steps.ts:27-104）が要求する情報と一致する。executor.ts:82-201 は command 種別ごとに `…
- なぜ問題か: 同じ業務の流れを Lean（Scenarios.lean の #guard / golden）と e2e（flows.ts）で二重に書いており、モデルが変わるたびに両方を手で追随させる必要がある（CLAUDE.md:304-306）。手書きゆえに golden にある拒否経路・再調整案・番回し・担当操作が抜けている。また `scenarios/generated/*.json` は消費されないのに `generatedAt` 付きでコミットされ、毎回差分ノイズを生む。
- 直し方: `lean/golden/<name>-flow.json` → `e2e/scenarios/<name>.json`（StepIntent 列 + 期待観測）へのコンパイラを `e2e/scripts/` に置く。アダプタとして (a) employeeId→persona 表、(b) command→画面表、(c) `domainError` コード→`labels.ts` の文言（拒否 notice の期待値）、(d) `views.loanBoard[loan]`→`SheetSnapshot`（stage/extended/reminders/earlyAsked/remarks.length）の射影、(e) 絶対日付→`Scenario.today` からのオフセット、(f) `lent-tent` 初期状態→`lentRun` の手 + `setFakeTime(afterDue−today)` の展開、を定義する。UI に無い担当コマンドは `support/token.ts` で API step に、ボタンが隠れる拒否は「ボタンが無いこと」を期待する step に落とす。両環境の時計を `Scenario.today` に固定する e2e 専用スタックを用意すれば、生成 JSON を再びオラクルにでき相対日付の回避策も不要になる。手書きは navigation/サインイン境界など UI 固有フローに限定する。
- Cradle の規則: 仕様（実行可能モデル）の golden trace を唯一の流れの正本とし、UI シナリオはそこからアダプタ（persona 表・command→画面表・エラー→文言表・view→観測射影）で生成する。手書きシナリオは UI 固有の関心にだけ許す。生成物をコミットするなら消費されるものだけにする。

### [Medium] ローカルスタックの全ポート（mock IdP・DB・backend・frontend）が 0.0.0.0 に公開され、任意クレームのトークン発行と DB が LAN から到達できる

- 場所: `monowa/infra/envs/local/main.tf:178`（security）
- 根拠: main.tf:66-69, 178-181, 266-269, 325-328 の `ports { internal = … external = … }` に `ip` 指定が無い（kreuzwerker/docker の既定は 0.0.0.0 バインド）。infra/README.md:92「`claims` を変えれば誰にでもなれる（ローカル専用）」。variables.tf:37-42 DB パスワード既定 `monowa`。
- なぜ問題か: 社内 LAN・カフェの Wi-Fi 等で、同一ネットワークの第三者がモック発行者から任意の employeeId/steward 印付きトークンを取り、8081/8088 経由で backend を操作したり 5432 に固定パスワードで接続したりできる。ローカル専用という前提は「ホストの外に出ない」ことに依存しているが、その前提を IaC が担保していない。
- 直し方: 各 `ports` ブロックに `ip = "127.0.0.1"` を付ける（または変数 `bind_ip` の既定を loopback にする）。
- Cradle の規則: ローカル開発スタックのホスト公開ポートは loopback にバインドするのを既定にする。「ローカル専用だから固定パスワードでよい」は、ネットワーク到達性を loopback に閉じてはじめて成り立つ。

### [Medium] 担当（steward）が「社員が兼ねる」[HS-056] に改まった後も、モック発行者・personas・identity モジュール・本番手順は「担当は employeeId を持たない別立場」のまま

- 場所: `monowa/infra/envs/local/idp/login.html:90`（drift）
- 根拠: login.html:87-95 steward 行は `claims` に `custom:employeeId` が無く、コメント「担当は EmployeeId を持たない。貸し借りには関われない（notForSteward）」。e2e/src/model/personas.ts:190 `steward: … claims(undefined, undefined, true)`。infra/modules/identity/main.tf:76-77「担当 … 貸し借りには関わらない（EmployeeId を持たない）」、infra/README.md:220-224 本番の担当ユーザーを employeeId 無しで作る手順。対して documents/ddd/hotspots.md:64 HS-056「社員の誰かが兼ねる … 2026-08-17 の『貸し借りには関わらない別の立場』は改められた」、lean/Mono…
- なぜ問題か: モデル・backend は「社員 + 担当印」を前提にしているのに、ローカルの人物一覧にその人物が居ないため、e2e は担当が社員として貸し借りに参加する経路も、担当操作そのものも試せない。golden の `employee-lifecycle`（steward=true の chiaki が postIntent/raiseHand/designate/deactivate）を写す土台が無い。本番手順もモデルに反する担当ユーザー（`noActor` になる人）を作らせる。
- 直し方: login.html に「chiaki（担当を兼ねる）」行を追加し claims に `custom:employeeId:3` + `cognito:groups:[monowa-steward]` を載せる。personas.ts に `chiakiSteward` を足し、identity/main.tf のコメントと infra/README.md 手順 5 を「担当は既存社員に `monowa-steward` グループを付ける」形に直す。現在の employeeId 無し steward は「印だけで名義が無い人」の境界確認用として残してよいが、名前を `stewardOnly` 等に改める。
- Cradle の規則: ホットスポットの決着（HS-xxx の訂正）が出たら、モック IdP の人物表・テスト persona・IaC のコメント・運用手順を同じ変更で追随させる。Cradle は「人物表は 1 か所（例: personas 定義）から IdP 設定と e2e persona を生成する」形をテンプレート化する。

### [Medium] 本番で ECS Exec が既定で有効（task role に ssmmessages:* on "*"）

- 場所: `monowa/infra/modules/backend-service/variables.tf:164`（security）
- 根拠: variables.tf:161-165 `variable "enable_execute_command" … default = true`。ecs.tf:143 `enable_execute_command = var.enable_execute_command`。iam.tf:68-89 `ssmmessages:CreateControlChannel/CreateDataChannel/OpenControlChannel/OpenDataChannel` を `resources = ["*"]` で付与。04_operations.md:192「コンテナに入る: `aws ecs execute-command`（`enable_execute_command` が既定で有効）」。
- なぜ問題か: 稼働中コンテナへのシェルは DB シークレット（環境変数 `SPRING_DATASOURCE_PASSWORD`）を読める経路になる。常時有効だと IAM 側で `ecs:ExecuteCommand` を持つ全員が本番プロセスに入れる。iam.tf:5-6 の「アプリは AWS API を叩かない」という最小権限の思想とも整合しない。
- 直し方: 既定を `false` にし、障害対応時に `-var enable_execute_command=true` で一時的に有効化する運用にする。有効時も `ecs:ExecuteCommand` の IAM 条件（`ecs:container-name` / タグ）で対象を絞り、CloudTrail で監査する。
- Cradle の規則: デバッグ用の侵入経路（exec・ポートフォワード・bastion）は本番では既定オフにし、必要なときだけ IaC の変数で開ける。

### [Medium] 本番スタックが一度も apply されておらず、apply 時にしか出ない誤りが未検出のまま「本番」と呼ばれている

- 場所: `monowa/documents/infra-design/03_aws-production.md:242`（infra）
- 根拠: 03_aws-production.md:238-242「認証は入った … **未検証** — AWS への apply はまだ行っていない（`terraform validate` まで）」。infra-design/README.md「本番はまだ apply していない（`terraform validate` まで）」。terraform.tfvars.example:31-35 に初回 2 往復の手順、infra/README.md:175-189 に ECR 先行 apply の手順があるが、実行された記録が無い。
- なぜ問題か: `validate` は型と参照しか見ない。Cognito のカスタム属性スキーマ、`db.t4g.micro` での Performance Insights、CloudFront のマネージドポリシー参照、ARM64 イメージの起動、Secrets Manager の `:username::` 解決など、apply と起動で初めて分かる要素が多い。設計と実装のレビュー（04_operations の障害時表）も机上のまま。
- 直し方: サンドボックスアカウントで `bootstrap` → `-target ECR` → push → 全体 apply → 利用者投入 → 画面ビルド配布の一巡を実施し、結果（かかった時間・詰まった箇所）を infra-design に追記する。以後は CI の `terraform plan` を常設する。
- Cradle の規則: インフラの設計ドキュメントに「apply 済み／未 apply」の状態を明示し、未 apply の環境を本番と呼ばない。少なくとも 1 回の実 apply までを設計フェーズの完了条件に含める。

### [Medium] 監視の抜け: ELB 由来 5xx・稼働タスク数・ログ由来エラーのアラームが無く、ALB/CloudFront のアクセスログも無く、通知先が既定で空

- 場所: `monowa/infra/modules/observability/main.tf:30`（observability）
- 根拠: observability/main.tf:30-50 は `HTTPCode_Target_5XX_Count` のみ（ALB 自身が返す 502/503 = `HTTPCode_ELB_5XX_Count` は無い）。`treat_missing_data = "notBreaching"`（同 40）なのでタスクが全滅してメトリクスが消えても鳴らない。ECS の `RunningTaskCount`/デプロイ失敗、CloudWatch Logs のメトリクスフィルタ（ERROR/`ScriptStatementFailedException`）に相当するアラームが無い。backend-service/alb.tf:58-70 に `access_logs` ブロック無し、frontend-delivery/main.tf:108-212 に `logging_config` 無し。observability/variabl…
- なぜ問題か: 「入口が生きているか」を見張ると宣言している（main.tf:7）のに、入口が完全に落ちた（healthy target 0 → ALB が 503）ケースが最も検知しにくい。INFRA-Q-007 の初回デプロイ失敗もログ由来アラームがあれば即座に切り分けられる。アクセスログが無いと `X-Origin-Verify` 迂回の試行や認証失敗の傾向を後から追えない。既定の tfvars では通知先が無く、全アラームが誰にも届かない。
- 直し方: `HTTPCode_ELB_5XX_Count`、`AWS/ECS RunningTaskCount < desired`（Container Insights なしなら `ecs-cpu` と同じ dimensions で `treat_missing_data = breaching` を検討）、`aws_cloudwatch_log_metric_filter` で `ERROR`/起動失敗の検出、ALB `access_logs`（S3）と CloudFront `logging_config` を足す。`alert_emails` は prod で非空を validation で強制するか、README で必須にする。
- Cradle の規則: 可用性アラームは「メトリクスが消える」ケース（全滅）を必ず breaching 扱いで拾う。アクセスログは入口ごとに必ず有効化する。通知先が空のアラームを作らない（validation で止める）。

### [Low] faketime 連携がコンテナ名・パスを e2e 側にハードコードし、準備確認が backend 側しか見ない

- 場所: `monowa/e2e/src/support/faketime.ts:91`（e2e）
- 根拠: faketime.ts:88-94「infra/envs/local/outputs.tf の … と同じ値（terraform output を毎回読みに行くほどのことではない …）」として `monowa-local-backend` / `/home/app/faketime/backend-time` / `monowa-local-idp` / `/faketime/timestamp` を定数化。isFaketimeReady（同 58-71）は backend のファイルだけを `test -f` する。infra/envs/local/outputs.tf:37-61 は同じ値を出力として公開している。
- なぜ問題か: `var.name` を変えた e2e 専用スタック（前述の推奨）では即座に食い違う。idp 側だけ古いコンテナ（例: `-target` で backend だけ作り直した）だと readiness は true なのに `setFakeTime` が片側だけ効き、設計が最も避けたい「backend と idp の時計の食い違い → 401」を再現する。
- 直し方: `terraform -chdir=infra/envs/local output -json` を 1 回読んで値を取る（または環境変数で上書き可能にする）。`isFaketimeReady` は backend と idp の両方のファイル存在を確認し、片方だけなら理由付きで fail する。
- Cradle の規則: IaC の出力とテストハーネスの定数を二重に持たない。ハーネスは IaC の output（または共通の設定ファイル）を読む。

### [Low] tfstate バケットに転送時暗号化の強制（aws:SecureTransport）と KMS が無く、共有ヘッダが平文で載る state の保護が SSE-S3 のみ

- 場所: `monowa/infra/bootstrap/main.tf:64`（security）
- 根拠: bootstrap/main.tf:64-72 `sse_algorithm = "AES256"`、バケットポリシー無し。infra/README.md:277-278「state には CloudFront → ALB の共有ヘッダ（`random_password`）が平文で入る。state バケットの読み取り権限 = 本番の入口を迂回できる権限」。
- なぜ問題か: 設計側が state を機微情報と位置づけているのに、保護は公開ブロックと SSE-S3 に留まる。読み取り権限の監査（誰が `s3:GetObject` できるか）とアクセスログが無い。
- 直し方: `aws_s3_bucket_policy` で `aws:SecureTransport=false` を Deny、可能なら SSE-KMS（CMK）にして鍵ポリシーで読み手を絞る。S3 アクセスログか CloudTrail データイベントを有効化する。
- Cradle の規則: 「state は秘密」と書くなら、読み取り経路（TLS 強制・KMS 鍵ポリシー・アクセスログ）まで IaC で閉じる。

### [Low] モジュールディレクトリに .terraform.lock.hcl がコミットされている

- 場所: `monowa/infra/modules/identity/.terraform.lock.hcl:1`（slop）
- 根拠: `git ls-files infra/modules/identity` に `.terraform.lock.hcl` が含まれる（他モジュールには無い）。ロックファイルはルートモジュール（envs/*）で管理されるもの。
- なぜ問題か: モジュール内で `terraform init` を実行した痕跡で、envs 側のロック（6.x 固定）と食い違う可能性があり、読み手を惑わせる。
- 直し方: 削除し、`.gitignore` に `infra/modules/**/.terraform.lock.hcl` を足す。
- Cradle の規則: プロバイダのロックはルートモジュールだけに置く。モジュール配下のロック/ .terraform は生成物として無視する。

### [Low] 固定スリープによる同期と retries:0 の組み合わせ（テスト安定性を時間待ちに依存）

- 場所: `monowa/e2e/src/engine/executor.ts:261`（e2e）
- 根拠: executor.ts:261 `await page.waitForTimeout(1_000)`、auth.ts:69 `await page.waitForTimeout(800)`、executor.ts:255-257 notice 待ちの timeout を `.catch(() => undefined)` で握りつぶす。playwright.config.ts:184 `retries: 0`。ai-notes:24-44 が原因（StrictMode の二重マウント）を製品側の未解決事項として記録。
- なぜ問題か: 待ち時間は環境（CI の遅いマシン）で破られやすく、破れたときの症状は「片側だけ観測が欠ける差分」なので、パリティ差分と区別がつかない。
- 直し方: frontend 側に `data-e2e-settled`（クエリの inflight 数が 0 になったら立てる）や `aria-busy` を出し、それを待つ。`StrictMode` は `import.meta.env.DEV && !VITE_E2E` で外せるようにする。少なくとも `retries: 1` にして flaky と本物の差分を区別する。
- Cradle の規則: e2e の同期は時間ではなく状態（アプリが露出する settled シグナル）で待つ。フレームワークの開発時挙動（StrictMode）が原因の待ちは、e2e 用ビルドフラグで元から断つ。

### [Low] 観測が粗く、順番待ちの列・板の engaged 状態など Lean の views が持つ事実の多くを突き合わせていない

- 場所: `monowa/e2e/src/support/observe.ts:93`（e2e）
- 根拠: observe.ts:93-110 の Observation は routeHash / curtainTitle / notice / sheet（loanAction 系のみ）/ `.empty__title` だけ。`queue-and-give-up` の各手では `sheet` が null（executor.ts:266-281 で raiseHand/giveUp は sheetTargetOf 対象外）で、列に誰が何番目に居るか・板の表明が `engaged` かは比較されない。golden の `views.intentBoard[].engaged/waiting` と `views.myLine` はこれを持つ。
- なぜ問題か: 順番待ち関連（HS-018/HS-025）は e2e が「通った」と言っても notice の文言しか比べていない。REST 側で列の順序が壊れても検出できない。
- 直し方: `observe` に `boardSnapshot`（表明ごとの engaged 印・待ち人数）と `lineSnapshot`（自分の順番待ちの品目と順位）を足し、golden の `views` からの射影と同じ形にする（前述の生成器と共通化できる）。
- Cradle の規則: UI パリティの観測項目は、仕様側の view（read model）の項目から逆引きして決め、view にある事実は必ず何らかの DOM 観測に写す。

### [Low] 設計ドキュメント・README に古い状態節が残り、現行の姿と矛盾する（旧モデルの INSERT 手順、「画面はまだサインインしない」）

- 場所: `monowa/infra/README.md:95`（drift）
- 根拠: infra/README.md:95-116「起動したら組織図を入れる … `standing` は … `Member` / `Manager` / `Executive` / `Hr`」— 警告付きだが、同 101「下の手順が有効なのは、いまのコードがまだ旧モデル・認証無しのままだから」は現在（認証済み・2 値 standing）では偽。documents/infra-design/02_local.md:271-288「実装の状況（2026-08-19）… ⏳ 画面はまだサインインしない … UseCase の追随が途中 … ビルドが通らない」— 2026-09-02 の e2e は画面からサインインして 15 本通っている。infra/README.md:22-24 と 36-39 に同じ段落が重複。infra-design/README.md の決定表で INFRA-D-021 が INFRA-D-019 の前に並ぶ。
- なぜ問題か: 「設計の正本は documents/infra-design」（infra/README.md:3）と宣言しているので、正本に古い状態節が残ると、読み手（人も AI も）が現行の姿を誤認する。実際 ai-notes:69-71 で「幕の文言が現行のソースに存在しない」ことから古さに気づいた経緯があり、文書の鮮度が作業の正確さに直結している。
- 直し方: README.md:95-116 を削除し「人を入れる」（04_operations.md）へのリンクに置き換える。02_local.md の「実装の状況」節は日付付きの履歴として `documents/ai-notes/` に移し、正本には現在形の記述だけを残す。重複段落を 1 つにする。
- Cradle の規則: 設計の正本には「現在形」だけを書き、時点付きの進捗・履歴は別の場所（ai-notes/CHANGELOG）に隔離する。「実装後の見直し」を書くときは古い節を消すか取り消し線ではなく差し替える。

#### そのまま持ち込んでよい良い実践

- ローカルにも本番と同じ経路（JWT + JWKS + iss/aud/token_use 検証）のモック OIDC 発行者をコンテナで立て、「検証を飛ばすプロファイル」を作らない（INFRA-D-018、infra/envs/local/main.tf:88-185、backend SecurityConfig.kt:44-57）。Cradle は mock-oauth2-server + 人物表（login.html 相当）+ PKCE でトークンを直接取る support/token.ts をテンプレート化すべき。
- iss（ブラウザから見た URL）と jwk-set-uri（コンテナ網から見た URL）を分けて渡す設計と、その理由の明文化（infra/envs/local/main.tf:95-111）。
- backend と idp 両方のコンテナの時計を libfaketime でオプショナルに、かつ同期して固定する仕組み（INFRA-D-021）。`@` 前置で時を進め続ける・`FAKETIME_DONT_FAKE_MONOTONIC=1`・`FAKETIME_NO_CACHE=1`・初期値は Terraform `upload`（volume の古い値問題を回避）・distroless イメージへは `ENV LD_PRELOAD` と `docker cp`・本番イメージには multi-stage の build arg で焼かない、という実測に裏付けられた判断（infra/envs/local/idp/Dockerfile、backend/docker-entrypoint.sh、e2e/src/support/faketime.ts）。Cradle は「時計を持つ全コンポーネントを同時に固定する」規則としてテンプレート化する。
- nginx の `/api/*` プロキシで CloudFront のビヘイビアを再現し、same-origin（CORS 不要）という前提を dev/local/prod の 3 環境で同じ形に保つ（frontend/nginx/default.conf.template、frontend-delivery/main.tf:153-162）。
- CloudFront に `custom_error_response` を置かない判断とその根拠（API のエラー契約 404/403 を 200+HTML に書き換えてしまう — INFRA-D-014、frontend-delivery/main.tf:164-185）。
- UTC 固定を DB パラメータ・コンテナ TZ・JVM `-Duser.timezone` の 3 層で揃え、`random_page_cost=1.1` もローカルと本番で揃える（INFRA-D-011/020）。「プランを確かめる場を本番と揃える」規則は汎用。
- jar が無ければ `precondition` で何をすべきか（`./gradlew bootJar`）を出して止める（infra/envs/local/main.tf:231-236）。`filesha1` による jar/ソース/焼き込み値の変更検知（同 222-226, 301-307）。
- DB のマスタパスワードを RDS 管理の Secrets Manager に置き state に載せない、execution role の secretsmanager/kms を ARN と `kms:ViaService` 条件で絞る（database/main.tf:93-95、backend-service/iam.tf:32-53）。
- ECR immutable タグ + scan_on_push + コミット SHA タグでのデプロイ（backend-service/ecr.tf）。
- CloudFront → ALB の 2 段防御（マネージドプレフィックスリスト + 共有ヘッダのリスナールール、既定 403）と、その秘密が state に載ることの明示（backend-service/alb.tf、infra/README.md:277-278）。
- state バケットの bootstrap（バージョニング・SSE・公開ブロック・prevent_destroy・S3 ネイティブロック `use_lockfile`）を独立スタックにする（infra/bootstrap/main.tf）。
- モジュールにプロバイダ設定を置かず envs で環境ごとに値を変える、循環を避けるため DB の受け入れ SG 規則を env 側で結線する（infra/envs/prod/main.tf:89-98、04_operations.md:5-21）。
- 設計ドキュメントの形式: Lean 仕様からの非機能要件の導出（01_model-to-infra.md）、「モデルに無いから作らないもの」の反機能一覧（§9）、決定 ID（INFRA-D）/前提（INFRA-A）/未決（INFRA-Q）の 3 表、「実装後の見直し」を追記する運用。Cradle の infra-design スキルはこの構造をそのままテンプレート化すべき。
- 3 プロファイル（test: H2 + 発行者不要 / local: PostgreSQL + モック発行者 / prod: RDS + Cognito）と「テストにコンテナを要求しない」規約（infra-design/README.md「環境」表）。
- `seed-local.sql` を local プロファイル限定・schema.sql と分離・冪等（差分行だけ更新、identity の歯抜けを避ける）にしている（backend/src/main/resources/db/seed-local.sql）。
- コンテナ版（8088/8081）とホストの開発ループ（5173/8080）のポートを分け、DB と発行者だけ共有して同時に立てられる（02_local.md「2 つの動かし方」）。
- e2e: 保存した golden をオラクルにせず、同一テスト内で Lean と REST を順に走らせて実測同士を突き合わせる（tests/parity.spec.ts）。日付は「いまから n 日」の相対指定（support/dates.ts）。
- e2e: ID に頼らず品目ラベル + 当事者の社員番号で紙面を特定し、フローごとに専用の品目ラベルを使う（support/observe.ts、flows.ts 冒頭）。REST 側の採番が Lean と違っても比較できる。
- e2e: 生成と再生を同じ Executor で動かす（解釈のずれを排除）、baseline は TRUNCATE 後に REST API 経由で作り直す（SQL で業務データを捏造しない）、faketime が無効なら理由付きで skip する（parity.spec.ts:19-27）。
- e2e: Notice が自動で畳まれる前に「目印の無い新ノード」を捉えて読む技法（executor.ts:237-263）と、既知の不安定さ（StrictMode 二重マウント / NOTICE_LIFE / 古いコンテナ）を原因ごと README と ai-notes に残す運用。
- `workers: 1 / fullyParallel: false` を理由付きで明示している（playwright.config.ts:175-183）— 暗黙の直列化ではなく、なぜ並列にできないかが書かれている。
- CLAUDE.md の開発順序（DDD → インフラ設計 → Lean → フロント → 人間レビュー → backend → e2e で締める）に e2e が組み込まれ、「差分が出たら backend の追随漏れか Lean の見直しかを切り分ける」判断規則がある（CLAUDE.md:300-310）。

## slop・drift（散文と規約）

### [High] CLAUDE.md と frontend/README.md が存在しない 6 画面（#/mine/*）・lib/mine.ts・ScopeNote.tsx を規約として記述（既知のまま放置）

- 場所: `monowa/CLAUDE.md:234`（drift）
- 根拠: CLAUDE.md:234 `モデルの述語の写しは src/lib/mine.ts の 3 つだけで、ここから増やさない。` L235-236 `画面は 6 枚で URL は #/mine/arranging #/mine/inhand #/intents #/intents/:id #/loans #/relationships` / frontend/README.md:117-124 同表、L166 `components/ScopeNote.tsx`、L169 `lib/mine.ts の 3 つだけ` — 実装 `frontend/src/state/MonoWaProvider.tsx:32-37` は `intents|loans|closed|line|relationships` の 5 画面、`frontend/src/lib/` に `mine.ts` なし、`components/` に `ScopeNo…
- なぜ問題か: 画面の枚数・URL・「写しは 3 つだけ」は frontend-ux-reviewer が「規約の正本」として照合する項目（agent:312-313）。正本が偽だとレビューが偽陽性を量産し、AI が `#/mine/arranging` を復活させる根拠にもなる。「別件なので触らない」は drift を意図的に残す振る舞い。
- 直し方: CLAUDE.md:234-236 と frontend/README.md:115-128,166-171 を現行 5 画面・`lib/visible.ts` に合わせて書き直す。CI: `grep -rn '#/mine\|mine\.ts\|ScopeNote' CLAUDE.md frontend/README.md` を 0 件に。運用規則: 正本の記述と実装が食い違うのを見つけたら同じ変更で正本を直す（ai-notes に「別件」と書いて残さない）。
- Cradle の規則: コードの構造（画面一覧・URL・ファイル名）を散文に写した箇所は、当該コードを変更するコミットで必ず更新する。「食い違いを知っているが別件」という申し送りを禁止し、見つけた食い違いは同一変更で解消するか issue にする。散文中のパス・URL は CI で実在検査する。

### [High] CLAUDE.md「DB は H2 のインメモリが既定」が application.yml の既定（local = PostgreSQL）と矛盾

- 場所: `monowa/CLAUDE.md:152`（contradiction）
- 根拠: CLAUDE.md:143 `#### 永続化（jOOQ + H2）` L152 `DB は H2 のインメモリが既定。永続化の方式は未決なので、外部依存なしで動くことを優先している。` — `backend/src/main/resources/application.yml` `profiles: default: local`（コメント「これが無いと DataSource が組み込み H2 に落ち…」）、`application-local.yml` `url: jdbc:postgresql://localhost:5432/monowa`。`documents/infra-design/README.md:70-72` も test だけ H2。
- なぜ問題か: CLAUDE.md は毎セッション読まれる最上位の文脈。既定 DB を誤認すると「DB 不要で bootRun できる」前提で作業し、起動失敗・誤った回避策（H2 用 SQL）に進む。
- 直し方: L143 見出しを `永続化（jOOQ + PostgreSQL / test は H2）` に、L152 を「既定プロファイルは local（PostgreSQL コンテナ必須）。H2 は test だけ」に直す。CI 補助: `grep -n 'H2' CLAUDE.md` の各行を `application*.yml` の記述と突き合わせるレビュー項目。
- Cradle の規則: 設定の既定値（プロファイル・DB・ポート）は設定ファイルを正本にし、文書には「どのファイルを見るか」だけ書く。文書に値を写す場合は CI で当該設定ファイルと grep 突合する。

### [High] domain-mockup スキルが写真アルバム UI の規約・チェックリストのまま、CLI コマンド数も正本と食い違う

- 場所: `monowa/.claude/skills/domain-mockup/SKILL.md:57`（drift）
- 根拠: L57 `最初の画面は「おすすめ」[UX-006]。タブは おすすめ / 時系列 / 作者 / いいね の 4 入り口 [イベント#4]。` L58 `アルバムは常に全メディアが掲載順で展開表示される [HS-021][HS-022]` L71-76 チェックリスト（いいね・空フォルダの保存・同一作者） / L39 `init / step / views / dump の 4 コマンド` vs `lean/README.md:69` `init / step / views / flow / dump` / assets/public/index.html:30-33 `data-tab="recommended"` `timeline` `authors` `liked`
- なぜ問題か: monowa の `UX-006` は「借りた物が失われた」、`HS-021` は「二重貸し」で、ID が同じまま意味が別物になっている。AI が「[HS-021] に従って展開表示」と読めば、存在しない業務規則を画面に足す。コマンド数の食い違いは golden 生成手順を壊す。
- 直し方: 「画面設計の規約（MonoWa）」節と動作確認チェックリストを削除し、`lean/README.md`「モックアップ」節への参照 1 行に置き換える。コマンド一覧は `lean/Main.lean` を正本にして複製しない。lint: `.claude/**` 内の `\[(HS|UX|MQ)-[0-9]+\]` が `documents/ddd/*.md` の同 ID の問い文と対応しているかを人手レビュー項目にする（自動化は ID の隣接語を用語集と突き合わせる）。
- Cradle の規則: スキルにドメイン固有の画面規約・チェックリストを埋め込まない。ドメイン固有の決めごとは製品側の正本（README/ddd）に置き、スキルはそこを参照する。ID 付きの規則をテンプレート間でコピーしない（ID は製品ごとに意味が変わる）。

### [High] infra/README.md に「認証を入れる前の姿」と注記した旧手順が丸ごと残り、同文書の他節と矛盾

- 場所: `monowa/infra/README.md:95`（slop）
- 根拠: L97-101 `> ⚠ **この手順は「認証を入れる前」の姿。** 設計は 2026-08-17 に変わっており…下の手順が有効なのは、いまのコードがまだ旧モデル・認証無しのままだから。` L104-105 `standing はモデルの語彙をそのまま使うこと（Member / Manager / Executive / Hr）` L109-115 `INSERT INTO employee ... 'Manager'` `-d '{"ownerId":1,"kind":"Lend",...}'` — 同文書 L58 は「`/api/healthcheck` 以外はすべてトークンが要る」、L100 自身が「`standing` の語彙も 2 値」と言い、`07_presentation.md:82` は Request に `ownerId` を持たせないと規定
- なぜ問題か: README は手順書として実行される。旧手順は 401 と 400 で必ず失敗し、`Manager` という存在しない語彙を DB に入れる。「有効なのは旧モデルのままだから」という前提はすでに偽で、注記自体が嘘になっている。
- 直し方: L95-116 を削除し、`02_local.md:250-262` の現行手順（発行者に人を置く→サインアップ）へ 1 行で誘導する。lint: `grep -rnE '⚠|この手順は.*(前|時点)の姿|旧モデル|認証無し' infra/README.md documents/**/*.md`。
- Cradle の規則: 無効になった手順・コマンド例は注記して残さず削除する。文書内に「〜の前の姿」「〜時点の記述」「旧」と書かれた節は lint で検出し、削除か現行化のどちらかを要求する。

### [High] lean-conventions.md が日付付き裁定・外部文書番号・別ドメイン例で 737 行に膨らんでいる

- 場所: `monowa/.claude/skills/lean-domain-model/references/lean-conventions.md:29`（history）
- 根拠: L29 `**DomainService の判定基準はルール 3 訂正(20260809・エキスパート)**` / L84 `documents/fable-discussion/kotlin-codegen-feedback-response.md` §1（不在） / L181 `**ルール 4 改訂（20260808）: Entity の型クラス+Lawful クラスは廃止**` / L186 `型クラスは v1→v4 で正しいローカル署名を発見する**診断装置**として役目を終えた` / L565 `裁定 18 で読み書き一様化` / L694 `kotlin-codegen-feedback.md 所見 4` / L95-166 のコード例は `Author` `Album` `MediaId` / 太字 155 個
- なぜ問題か: 規約の読者は「いま何をすべきか」だけが要る。改訂日・旧ルール・別リポジトリの図番号（図 10 / R11-A1 / 逆提案 1）は検証不能な権威付けにしかならず、AI はそれを根拠として引用し続ける。長さと太字密度のせいで本当に守るべき固定形（validate/execute）が埋もれる。
- 直し方: 各節を「規則 + 理由 1 段落 + monowa の実例 1 つ」に圧縮し、履歴は削除（必要なら ai-notes へ）。lint: `grep -nE '20[0-9]{6}|20[0-9]{2}-[0-9]{2}-[0-9]{2}|裁定|改訂|退役|逆提案|図 [0-9]+|R[0-9]+-[A-Z]?[0-9]*|v[0-9]→v[0-9]' .claude/**/*.md` を 0 件にする。太字密度: `grep -o '\*\*[^*]*\*\*' f | wc -l` ÷ 行数 > 0.1 で警告。
- Cradle の規則: 規約・reference 文書には改訂日・旧ルール・撤回された案・他リポジトリの決定番号を書かない（履歴は VCS と ai-notes が持つ）。`20YYMMDD`/`YYYY-MM-DD`/「裁定・改訂・退役・撤回」を規約ファイルで grep して 0 件にする。1 節 = 規則 + 理由 + 実例 1 つ、太字は 10 行に 1 個以下。

### [High] lean-domain-model スキルが別プロダクト（Album/Media/Author）の層構成・パスを丸ごと記述している

- 場所: `monowa/.claude/skills/lean-domain-model/SKILL.md:148`（drift）
- 根拠: L153 `├── DomainComposition.lean    # 合成ライブラリの**正本**` / L164-166 `Media.lean` `Author.lean` `Album.lean` / L199 `├── Spec/` L204 `├── Refinement/` / L256 `grep ... UseCase/(SaveUseCase|LikeUseCase|UnlikeUseCase|CorrectAlbumUseCase|RenameAuthorUseCase)/` / L263 `この一式は .github/workflows/lean.yml の CI としても実行される` — 実在するのは `lean/MonoWa/{Application,Domain,Laws,Runtime}` のみで、`Refinement/` `Spec/` `Composition` `DomainCompo…
- なぜ問題か: スキルは「作業規約・マッピング規則はすべてそこにある」と agent（lean-domain-modeler.md:19）から必読指定されている。存在しないディレクトリへの配置指示・存在しない UseCase 名の grep・存在しない CI への同期要求を AI が真に受けると、monowa に無関係な構造（Refinement 層、Album 語彙）が生え直す。Cradle が最も再発させやすい類型。
- 直し方: スキル本文の「lean/ 内部の層構成」「出力構成」「検証コマンド」を `lean/README.md` の実構成に置き換え、例は monowa の語彙（Employee/Intent/Loan）だけにする。CI: `grep -ohE '`[A-Za-z0-9_./-]+(\.(lean|kt|ts|tsx|md|yml|yaml|sql)|/)`' .claude/**/*.md CLAUDE.md documents/codestyle/*.md | tr -d '`' | sort -u | while read p; do [ -e "$p" ] || echo "MISSING $p"; done` を回し、MISSING を 0 にする。別プロダクト語彙は `grep -rn 'Album\|Media\b\|Author\|いいね\|Akashic' .claude` で検出。
- Cradle の規則: ハーネス散文（SKILL/agent/references/CLAUDE.md）がバッククォートで名指すパス・ファイル・識別子は必ずリポジトリに実在すること。CI でバッククォート内のパス様文字列を抽出して `test -e` し、未解決参照 0 を必須にする。例示は当該プロダクトの語彙だけを使い、テンプレート元プロダクトの固有名詞（Album 等）を残さない。

### [High] scaffold に別プロダクト名 Akashic.lean と存在しないモジュール群が同梱されている

- 場所: `monowa/.claude/skills/lean-domain-model/assets/scaffold/Akashic.lean:15`（drift）
- 根拠: ファイル名 `Akashic.lean`（別プロダクト名）。L3 `Spec(保証・正本) ← Domain(...)` L15-17 `import MonoWa.Domain.Entity.Author` `import MonoWa.Domain.Entity.Media` `import MonoWa.Domain.Entity.Album` L19 `import MonoWa.Domain.Composition` L23 `import MonoWa.Application.QueryService.ReadStore` — いずれも monowa に存在しない。同ディレクトリ `README.md:19` も `Spec/（保証 = 定理だけ）・Refinement/（接続）` を層として説明
- なぜ問題か: SKILL.md「初回生成」手順 1 は「`assets/scaffold/` の中身を `lean/` にコピーする」。Cradle で新製品を起こすと、初手で別製品の名前と壊れた import 群がコピーされ `lake build` が通らない。
- 直し方: scaffold を製品名非依存（`{{Project}}.lean` のテンプレート化）にし、import は Prelude/Annotations/Error/Main の最小集合だけにする。CI: scaffold を一時ディレクトリに展開して `lake build` を通す。grep: `grep -rln 'Akashic\|Album\|Media\|Author' .claude/**/assets/`。
- Cradle の規則: スキルの assets/scaffold は製品固有名を含まず、コピー直後にそのままビルドが通る状態を CI で保証する（テンプレート変数以外の固有名詞は禁止）。

### [High] 「ID をコードに書かない」規約と「全定理に ID を付ける」スキルが正面衝突し、コードには 110 か所残る（規約は「残存 0」と主張）

- 場所: `monowa/documents/codestyle/08_comments.md:31`（drift）
- 根拠: 08_comments.md:31 `HS-xxx / MQ-xxx / UX-xxx / イベント#n をコードに書かない。` L98 `ステータス語と ID 参照を除去した（残存 0）` — 一方 `.claude/skills/lean-domain-model/SKILL.md:133` `すべての型・フィールド・定理・分岐に、根拠となる [HS-xxx] [UX-xxx] [MQ-xxx] [イベント#n] をコメントで付ける。`、`.claude/agents/lean-domain-modeler.md:46` 同旨。実態: `grep -rn 'HS-[0-9]\|MQ-[0-9]\|UX-[0-9]\|イベント#'` が backend/lean/frontend で 110 行ヒット（例 `ActorContextFactory.kt:30 [HS-062][HS-055][MQ-032 反映済]`、`Emp…
- なぜ問題か: 同じ主題に逆向きの規則が 2 か所あると AI はどちらにも従え、どちらにも違反する。ステータス語 `反映済` を含む参照は 08_comments.md が実例（MQ-012 事故）で示した「腐る根拠」そのもの。「残存 0」という数量の断定が偽になっており、規約自体の信頼を落とす。
- 直し方: 方針を 1 つに決め（08 の「書かない」が筋）、`lean-domain-model/SKILL.md:133` と `lean-domain-modeler.md:46` を「出典は docstring に自然文で全文引用し ID は書かない」に改める。CI: `grep -rnE '\[(HS|MQ|UX)-[0-9]+|イベント#[0-9]|反映済|未決\]' lean/MonoWa lean/Main.lean backend/src/main backend/src/test frontend/src` を 0 件にする。「残存 0」の文は削除。
- Cradle の規則: 同じ主題の規則は 1 ファイル 1 か所にしか書かず、他は参照する。規約が禁じるパターンには必ず対応する grep を CI に置き、「残存 0」のような数量の断定は文書に書かず検査結果で示す。

### [High] インフラ設計の正本に日付付き進捗チェックリスト（✅⏳）が残り、⏳ 項目が今は偽

- 場所: `monowa/documents/infra-design/02_local.md:271`（history）
- 根拠: L225 `## 現時点の状態（2026-08-16 実機確認）` L231-239 `- ✅ terraform apply が通る…` L271 `## 実装の状況（2026-08-19）` L280-282 `- ✅ **backend の Resource Server 設定は入った**。SecurityConfig…と、名義を Controller の引数に解決する 2 つの ArgumentResolver（EmployeeActor / StewardActor）。` L283 `- ⏳ **画面はまだサインインしない**` L285 `- ⏳ **UseCase の追随が途中**…ビルドが通らない` — `EmployeeActor`/`StewardActor` は存在せず（`presentation/auth/` は `ActorContextFactory.kt` と `AuthClaims.kt` のみ）…
- なぜ問題か: CLAUDE.md:355 は `documents/infra-design/` を「設計の正本」と定めている。正本に進捗ログが混ざると、AI は「画面はまだサインインしない」「ArgumentResolver がある」を現在の事実として読む。絵文字付きステータスは差分レビューでも目に入りにくい。
- 直し方: 02_local.md:225-290・README.md:16-64・03_aws-production.md:238-243 の日付付き状態節を削除し、必要な事実だけ本文に統合する。進捗記録は ai-notes へ。lint: `grep -rnP '[\x{2705}\x{274C}\x{23F3}\x{1F527}\x{26A0}]|^##+ .*（20[0-9]{2}-[0-9]{2}' documents/infra-design documents/codestyle` を 0 件に。
- Cradle の規則: 設計の正本は「現在の構成」だけを書き、日付付きの進捗・実測ログ・済んだ順のチェックリストを置かない（それは ai-notes/ADR の役割）。正本ディレクトリでは絵文字と『## 〜（YYYY-MM-DD）』見出しを lint で禁止する。

### [Medium] 05_configuration.md が「実装追随までは暫定 H2」「2026-08-14 ユーザー方針」など期限切れの状態と日付を規則に混ぜている

- 場所: `monowa/documents/codestyle/05_configuration.md:11`（history）
- 根拠: L11 `**PostgreSQL 17 のコンテナ**（infra/envs/local）[ADR-002] — 実装追随までは暫定 H2` L35 `## インフラ設計フェーズ(2026-08-14 ユーザー方針)` L42-43 `local の DB(規約上 Docker・実装は H2 — documents/ai-notes/20260814-01 の乖離)の確定もこのフェーズで行い、それまでは外部依存なしで動くこと(H2)を優先する。` L45 `（2026-08-16 に作成、実装は infra/）` — 実装は追随済み（application-local.yml は PostgreSQL）
- なぜ問題か: 「暫定」「それまでは」は条件付き規則で、条件が満たされた後は誤読の元（H2 を local で使ってよいと読める）。日付は規則の内容に寄与しない。
- 直し方: L11 の「— 実装追随までは暫定 H2」、L35-47 の節を削除し、フロー説明は CLAUDE.md「開発の順序」への参照 1 行にする。lint: `grep -nE '暫定|それまでは|追随まで|20[0-9]{2}-[0-9]{2}-[0-9]{2}' documents/codestyle/*.md`。
- Cradle の規則: 規約に「〜までは暫定」「それまでは」といった期限付き条項を書かない。期限が来たら消す前提の文は最初から書かず、issue にする。規約ファイルで日付を lint 禁止する。

### [Medium] 07_presentation.md / 08_comments.md が撤回・廃止の年月日入り経緯と事故の物語を規則本文に含む

- 場所: `monowa/documents/codestyle/07_presentation.md:104`（history）
- 根拠: 07_presentation.md:104-105 `（2026-08-17 の「担当は貸し借りに関わらない」[HS-045] は 2026-08-21 に撤回されており、それを根拠にしていた notForSteward は 2026-09-01 に廃止した。）` / 08_comments.md:5-17 `2026-08-21、社員同士の関係性の一覧が…分かった。原因はコードのコメントだった。` L77-78 `（2026-08-21 時点で契約テストは 1 本も繋がっていない。…）`（現在は 39 クラス配線済み — 20260829-01） L96-108 `## 既存コードの扱い 2026-08-21 に…除去した（残存 0）…食い違ったまま残っていたコメントが 3 つ見つかった`
- なぜ問題か: 08 は「変わる情報を更新されない場所に写すな」と説く文書そのものが、更新されない事故日誌と偽の現状（契約テスト 0 本）を抱えている。規則より物語が長いと AI は物語を根拠に引用する。
- 直し方: 07:104-105 を削除。08 は「規則 1-5」だけ残し、「なぜ」「既存コードの扱い」は 1 段落の理由に圧縮するか ai-notes に移す。lint は finding #2 の日付 grep を codestyle に適用。
- Cradle の規則: 規約 = 規則 + 短い理由。事故の経緯・撤回の日付・作業記録は postmortem/ai-notes に置き、規約からはリンクだけにする。

### [Medium] @Suppress("unused") で生かした参照専用の定数 GATE（死んだコード）

- 場所: `monowa/backend/src/main/kotlin/com/monowa/presentation/error/MonoWaAccessDeniedHandler.kt:58`（dead-code）
- 根拠: L54-60 `private companion object { /** SecurityConfig の振り分けと同じ前置き(片方だけ変えると語が食い違う)。 */ const val STEWARD_PATH = "/api/steward/"  @Suppress("unused") val GATE = SecurityConfig.STEWARD }` — `GATE` はどこからも参照されない（grep で本ファイルのみ）。`SecurityConfig` の import もこのためだけ
- なぜ問題か: 「結びつきを示すため」に未使用シンボルを置き、警告を抑止して残す典型的 slop。結びつき（パス前置きの一致）は実際にはこの定数では検査されず、読者に偽の安全感を与える。
- 直し方: `GATE` と `SecurityConfig` import を削除し、`STEWARD_PATH` を `SecurityConfig` 側の定数（`"/api/steward/**"` の元）として 1 か所に置いて両者から参照する。CI: `grep -rn '@Suppress("unused")' backend/src/main` を 0 件に。
- Cradle の規則: 本番ソースで `@Suppress("unused")`（および `// eslint-disable no-unused-vars` 等）を禁止する。関係を示したいなら片方をもう片方から実際に参照させる。

### [Medium] ID の機械除去の残骸で文が壊れている（「2026-08-16 ので」）・イベント番号 [#10] が生き残っている

- 場所: `monowa/lean/MonoWa/Domain/DomainService/TurnPassing.lean:9`（slop）
- 根拠: TurnPassing.lean:9-10 `**コマンドではない**: 2026-08-16 ので「貸す側の操作は要らない（自動で回る）」と 確定したため、旧 startNextTurn コマンドは廃止した。`（「〜の」の後の名詞が欠落） / LoanImpl.kt:86 `/* ── 受け渡し [#10] ───` L101 `/* ── 遅れ [#8a][#8b][#13] ───` / SecurityConfig.kt:93 `// 担当だけの口 [#0b][#0d]。` L97 `[HS-056]` — 08_comments.md:100-103 自身が「ID を消すと主語や理由を失った文が残るため手で直す必要がある」と警告している
- なぜ問題か: 機械除去（sed）の後に文を読み直していない証拠。意味の欠けたコメントは読者に「何かが消された」ことしか伝えず、AI は前後から推測で補う。`[#10]` 形式は 08 の grep パターン（`イベント#`）をすり抜けている。
- 直し方: 壊れた文は書き直すか削除。lint: `grep -rnE '[0-9]{4}-[0-9]{2}-[0-9]{2} (ので|から|に|で)|\[#[0-9]+[a-z]?\]' lean backend/src frontend/src`。機械置換を行った PR は「触った各コメントを人が読む」チェック項目を必須にする。
- Cradle の規則: コメントの機械的な一括置換・削除を行ったら、変更行を 1 行ずつ読み直して文として成立するか確認する（sed だけで終えない）。ID の別表記（`[#n]`）も禁止パターンに含める。

### [Medium] codestyle が存在しない ai-notes（20260813-04 / 20260814-01）と別ドメインの例（Album/Like/Save）を根拠にしている

- 場所: `monowa/documents/codestyle/03_usecase.md:5`（drift）
- 根拠: 03_usecase.md:5-6 `（2026-08-13 改訂 — 経緯は documents/ai-notes/20260813-04-validation-layering-analysis.md）` L19 `validate(c: LikeCommand): DomainResult<DomainError, Album>` L20-21 `SaveUseCase` `TimelineUseCase` L28 `RecommendedUseCase` L117 `application/usecase/saveusecase/AlbumBulkAddBypass.kt` L170-181 `SaveUseCase がこれにあたる。アルバム群は all-or-nothing [UX-002]…` / 07_presentation.md:8 `documents/ai-notes/20260813-04 の判別4問` …
- なぜ問題か: 規約が「経緯はこの note を読め」と指す先が無く、例に出る UseCase も存在しないため、読者（AI）は規約の適用範囲を推測で補う。03 の「境界を割る」節は monowa に該当ケースが無いのに 20 行の別ドメイン解説が残る。
- 直し方: 不在の note 参照を削除し、例を `RaiseHandUseCaseImpl` / `LoanEngagementBypass` 等の実在名に置換。CI は finding #1 のパス実在検査を `documents/codestyle` にも適用。
- Cradle の規則: 規約の例示と参照は当該リポジトリに実在するファイル・識別子に限る（CI の参照実在検査の対象に codestyle を含める）。

### [Medium] frontend/README.md に文末が欠けた文と、lean/README と矛盾する「前借り」記述が残る

- 場所: `monowa/frontend/README.md:173`（slop）
- 根拠: L173-174 `本来この 4 画面はモデル側の閲覧 UseCase であるべきで、いまは前借りしている（documents/ai-notes/20260816-03-frontend-my-screens.md の）。`（「の）」で文が切れている） — `lean/README.md:125-128` は `参照系 5 件 IntentBoard / LoanBoard / ClosedLoans / MyLine / Relationships` を UseCase として持ち、閲覧は前借りではない。L138 `（2026-08-21 のレビュー指摘）`、L45 `旧 ActorPicker（社員を選ぶ箱）は撤去した`、L60 `GET /api/employees は撤去済み`、L188-189 `手書きの包み（旧 MonoWaClient / wire.ts / restWire.ts）は無い`、L232 根拠欄 `〜…
- なぜ問題か: 「規約の正本」（CLAUDE.md:225）に途中で切れた文と偽の前提が残ると、AI は欠けた部分を推測で補完する。「撤去した／は無い」の列挙は現在の読者に何も与えず、撤去したはずの `wire.ts` は `api/lean/wire.ts` として実在するため誤解も生む。
- 直し方: L173-174 を削除、L45/60/188-189 の「旧〜は無い」を消し現在の形だけ書く、L232 の `〜#5` を削除。lint: `grep -nE 'の）$|の。$|〜#[0-9]' frontend/README.md CLAUDE.md`、`grep -nE '撤去|旧 `' frontend/README.md`。
- Cradle の規則: README は現在の姿だけを書く。「旧 X は撤去した／無い」という不在の説明は書かない（必要なら反機能レジストリへ）。文末が助詞や括弧で終わる行を lint で検出する。

### [Medium] infra/README.md が「担当は社員とは別の利用者」と書き、frontend/README.md・hotspots HS-056 と矛盾

- 場所: `monowa/infra/README.md:220`（contradiction）
- 根拠: infra/README.md:220 `# MonoWa を管理する担当（社員とは別の利用者 — 貸し借りに関わらない）` — `frontend/README.md:68-71` `**管理する担当も社員である。** 担当は社員の誰かが兼ねていて…担当を別の立場として扱わないこと。`、`documents/ddd/hotspots.md` HS-056 `**社員の誰かが兼ねる**…2026-08-17 の「貸し借りには関わらない別の立場」は改められた`。`20260831-01-api-contract-rationale.md:92` にも同じ旧文が残存
- なぜ問題か: 撤回済みの業務事実が手順書に残り、Cognito にユーザーを作る手順が「担当には employeeId を付けない」形になっている（L221-222）。この手順どおり作った担当は `ActorContextFactory.steward()` で `unknownEmployee` になり、実機で必ず詰まる。
- 直し方: L220-224 を「担当も社員なので employeeId/departmentId を持たせたうえで group に入れる」に直す。ヒューリスティック: `hotspots.md` で「撤回」「改められた」と記された旧結論の文言（例 `貸し借りに関わらない`）を全文書で grep し、残存を 0 にする。
- Cradle の規則: ドメイン事実が撤回されたら、撤回された旧文言を全リポジトリで grep し残存を消す作業を /ddd の完了条件に含める（撤回語句リストを機械生成して検査する）。

### [Medium] sql-perf-review と frontend-ux-review の委譲手順がほぼ同文（対象確定／起動／フォールバック／結果中継）

- 場所: `monowa/.claude/skills/sql-perf-review/SKILL.md:46`（redundancy）
- 根拠: sql-perf-review/SKILL.md:20-24（git rev-parse / symbolic-ref / merge-base の 4 行）= frontend-ux-review/SKILL.md:32-36。sql:46-53 `フォールバック（この順で試す）: 1. … が agent type として見つからない場合: subagent_type: "general-purpose" + model: "opus" で起動し…2. Agent ツール自体が使えない環境の場合: 同ファイルを自分で読み…` = fe:81-87 同文。sql:57-60 = fe:91-103 「要約して削らずに」「修正の適用はユーザーが明示的に求めるまで行わない」
- なぜ問題か: レビュー系スキルを増やすたびに同じ 40 行が複製され、フォールバック手順を直すと全スキルを触ることになる。Cradle はスキルを配布物にするので、この形のまま配ると複製が製品ごとに増殖する。
- 直し方: 共通部分を `.claude/skills/_shared/review-delegation.md`（対象確定・起動・フォールバック・中継）に切り出し、各 SKILL は差分（レビュー観点・引数）だけを書いてリンクする。検出は finding #20 の重複行 CI。
- Cradle の規則: レビュー委譲型スキルの共通手順（diff の基点・サブエージェント起動・フォールバック・結果中継）は 1 つの reference に置き、各スキルは観点と引数だけを持つ。

### [Medium] 「モデルの述語の写しは 3 つだけ」という数量規則が、実装（visible.ts の 15 条件）と食い違う

- 場所: `monowa/frontend/src/lib/visible.ts:15`（drift）
- 根拠: visible.ts:15-29 `対応表（lean/MonoWa/Application/UseCase/ 配下それぞれの UseCase.lean の validate）: handOver borrower / canHandOver = arranged … discuss 当事者 / canRemark = 終わっていない`（13 操作）+ L45-52 `isActive` `afterHandover` の写し — CLAUDE.md:234 `モデルの述語の写しは src/lib/mine.ts の 3 つだけで、ここから増やさない。`、frontend/README.md:169-171 同旨（ファイル自体が不在）
- なぜ問題か: 「N 個だけ」という数量規則は守られているか誰も数えず、しかも写しの家が別ファイルに移ったことで規則の対象が消えた。対応表コメントは Lean の validate を手で写したもので、Lean 側が変わると黙って古くなる（08_comments.md の懸念そのもの）。
- 直し方: 規則を「出し分けの写しは `lib/visible.ts` の `allowedOn` に閉じる（他ファイルで stage/lender を判定しない）」に書き換え、lint で `grep -rn "stage.kind ===\|=== 'lent'" frontend/src/components` を禁止。対応表コメントは削除し、`convert.test.ts` と同様に golden から「出せる操作 ⊆ Lean が通す操作」を検査するテストで縛る。
- Cradle の規則: 「写しは N 個だけ」のような数量制約は散文に書かず、lint（許可ファイル外での判定禁止）か契約テストで守る。モデルの判定表をコメントに手で写さない。

### [Medium] 「引き合わせは廃止」「旧 startNextTurn」「旧 setActor」など、存在しない機能への言及がコードコメントに散在

- 場所: `monowa/backend/src/main/kotlin/com/monowa/application/usecase/raisehandusecase/RaiseHandUseCaseImpl.kt:20`（history）
- 根拠: RaiseHandUseCaseImpl.kt:20 `表明に手を挙げる — **唯一の成立経路** （引き合わせは廃止）。` / LoanRepositoryImpl.kt:196 `（引き合わせは廃止）` / TurnServiceImpl.kt:17 `（旧 startNextTurn は廃止）` / LoanOriginBehaviorsImpl.kt:9 `引き合わせの廃止で経路は…` / MonoWaProvider.tsx:25 `差し替える口（旧 setActor）は無い` / IntentSlip.tsx:111 `引き合わせも廃止。` / Command.lean:17-18 `- **引き合わせ**: 2026-08-16 に仕組みごと廃止…（旧 introduce は削除済み）` / ValueObject.lean:252 `旧 returned…は**廃止**` / Json.lean:25 `（旧 …
- なぜ問題か: 「無いもの」の説明はコードからは検証できず、時間とともに何が「旧」だったか誰も分からなくなる。反機能の理由は `Runtime/Command.lean` の反機能一覧 1 か所にあれば足りる。
- 直し方: 各コメントから「〜は廃止」「旧 X」を削り、必要なら反機能一覧（Command.lean）へ 1 行で集約。lint: `grep -rnE '旧 `?[A-Za-z]|廃止|撤去|以前は|かつて|削除済み|もともと' --include='*.kt' --include='*.ts' --include='*.tsx' --include='*.lean' backend/src/main frontend/src lean/MonoWa` を 0 件に。
- Cradle の規則: コードコメントは現在存在するものだけを説明する。廃止・撤去した機能への言及は反機能レジストリ 1 か所に限定し、個々のコードから「旧〜」「〜は廃止」を lint で排除する。

### [Medium] どの validate も返さない失敗語彙 IntentEngaged が Lean・Kotlin 両方に残る（契約からは外されている）

- 場所: `monowa/lean/MonoWa/Domain/Error.lean:52`（dead-code）
- 根拠: Error.lean:52-53 `/-- その表明はいま貸出中（進行中の一件がある）— 二重には貸さない。 -/ | intentEngaged` / DomainErrorMapping.kt:40 `DomainError.IntentEngaged -> "その表明はいま貸出中です"` — `grep -rn 'IntentEngaged\|intentEngaged'` の非生成ヒットはこの 2 行のみ（validate/execute からの生成は 0）。`documents/codebase/openapi.yaml` の ErrorCode には無く、`20260831-01-api-contract-rationale.md:138-144` が「使われていない語彙…語彙ごと消すかどうかはモデル側の判断」と申し送り
- なぜ問題か: 生成される契約テスト・エラー表・フロントの `REFUSALS` が語彙に引きずられる。「二重には貸さない」の拒否と読めるが実際の防波堤は `afterHandover` で、読者を誤誘導する。
- 直し方: `intentEngaged` を Error.lean から削除し再生成、`DomainErrorMapping.kt:40` を落とす。CI: `for c in $(grep -oP '^\s*\| \K\w+' lean/MonoWa/Domain/Error.lean); do grep -rq "\.error \.$c\b\|\.$c\b" lean/MonoWa/Application || echo "unused: $c"; done`。
- Cradle の規則: 失敗語彙（エラー enum）の各構成子は少なくとも 1 つの validate/execute から生成されること。生成されない構成子は削除する（「将来使うかも」で残さない）。CI で構成子 ↔ 生成箇所の対応を検査する。

### [Medium] コードコメントに撤回日・廃止日・HS/MQ ID・ステータスが残り、自らの規約 08_comments に違反

- 場所: `monowa/backend/src/main/kotlin/com/monowa/presentation/error/BoundaryErrors.kt:12`（history）
- 根拠: BoundaryErrors.kt:12-14 `担当は社員の誰かが兼ねる [HS-056]。2026-08-17 の「担当は貸し借りに関わらない」[HS-045] は 2026-08-21 に撤回されており、それを根拠にしていた「社員の口を担当が叩いた」という拒否(旧 notForSteward)は 2026-09-01 に廃止した` / ActorContextFactory.kt:30 `[HS-062][HS-055][MQ-032 反映済]` / ActorContextFactoryTest.kt:36 `（2026-09-01 に notForSteward を廃止した帰結）` / NotStartedCurtain.tsx:7 `（2026-09-01）` L17 `（2026-08-21）` / ValueObject.lean:15 `（2026-08-29 移行 —` L122 `2026-08-19 に …
- なぜ問題か: 08_comments.md 規則 1・2・4 が名指しで禁じるもの（ステータス・ID・経緯）。`反映済` は変わり得る状態で、撤回されればコメントが嘘になる。廃止された識別子（notForSteward）を残すと grep で「まだある」ように見える。
- 直し方: 該当コメントから日付・ID・ステータス・旧識別子を落とし「いまの事実」だけにする。CI: `grep -rnE '20[0-9]{2}-[0-9]{2}-[0-9]{2}|\[(HS|MQ|UX)-[0-9]+|反映済|未決|却下|撤回' --include='*.kt' --include='*.ts' --include='*.tsx' --include='*.lean' --include='*.css' backend/src frontend/src lean/MonoWa lean/Main.lean | grep -v generated` を 0 件に（日付リテラル `LocalDate.of`/`date("…")`/テスト fixture は除外パターンで許可）。
- Cradle の規則: コードコメントに暦日・トラッカー ID・ステータス語・撤回/廃止の経緯を書かない。コメントは「いまこの形である理由」だけを書く。CI で日付・ID・ステータス語をコメント中から grep して 0 件にする。

### [Medium] ハーネス散文で同じ指示が 4〜5 か所に複製されている（質問数上限なし・2フェーズ構造・backend 不要）

- 場所: `monowa/.claude/skills/ddd/SKILL.md:41`（redundancy）
- 根拠: 「質問数に上限は無い／分けるほうが高くつく」: ddd/SKILL.md:41-44, 57-59 / ddd-domain-explorer.md:68-69, 97-101, 128-129 / references/question-format.md:61-63（計 5 か所、ほぼ同文）。「探索は2フェーズ構造（documents/fable-discussion/lean-modelling.md 論点3）」: CLAUDE.md:317-319 / ddd/SKILL.md:10-20 / explorer.md:14-26 / lean-domain-modeler.md:10-15（4 か所、参照先は不在）。「backend が壊れていてもレビューは成立する」: frontend-ux-review/SKILL.md:61, 113-115 / frontend-ux-reviewer.md:118-119 / …
- なぜ問題か: 複製は片方だけ更新される運命にあり（fable-discussion 参照はすでに全箇所で死んでいる）、コンテキスト予算も浪費する。同じ文が繰り返されると AI はその指示を「特に重要」と過大評価し、他の指示を軽視する。
- 直し方: 各指示を 1 か所（役割上の正本）に置き、他は「→ explorer 定義『質問ターン』を参照」の 1 行にする。検出: `cat .claude/**/*.md CLAUDE.md | sed 's/^[ >*-]*//' | awk 'length>30' | sort | uniq -d`（正規化後の重複行）。
- Cradle の規則: ハーネス文書内で同じ指示・同じスクリプト断片を複数ファイルに書かない。正規化した行の重複を CI で検出し、正本 1 か所 + 参照に直す。

### [Medium] 未使用 import が main/test に残っている（ktlint で検出されていない）

- 場所: `monowa/backend/src/main/kotlin/com/monowa/domain/entity/LoanImpl.kt:12`（dead-code）
- 根拠: LoanImpl.kt:12 `import com.monowa.domain.domain.valueobject.Terms` — ファイル内で `\bTerms\b` は import 行のみ。同様に `ClosedLoansQueryServiceImpl.kt:25 import org.springframework.stereotype.Component`、`support/FixtureEntities.kt:15 import ...ReturnPromise`、`RemindUseCaseImplContractTest.kt:15` / `LoanEntityContractTestImpl.kt:10` / `TermsEntityContractTestImpl.kt` / `ProposeTermsUseCaseImplContractTest.kt` / `ProposeExtension…` …
- なぜ問題か: `./gradlew ktlintCheck` が build に組み込まれている（CLAUDE.md:32）のに残っているということは、標準ルール `no-unused-imports` が効いていないか無効化されている。未使用 import は「消したものの残骸」の指標で、LLM の書き換え後に特に増える。
- 直し方: `backend/.editorconfig` で `ktlint_standard_no-unused-imports = enabled` を確認し、build を落とす。簡易検査: `for f in $(find backend/src -name '*.kt'); do grep -oP '^import [\w.]+\.\K\w+$' "$f" | while read s; do grep -qv '^import' <<<"" ; grep -v '^import ' "$f" | grep -q "\b$s\b" || echo "$f: $s"; done; done`。frontend は oxlint `no-unused-vars` を error に。
- Cradle の規則: 未使用 import/変数を CI で error にする（ktlint no-unused-imports、oxlint/tsc noUnusedLocals）。lint 抑止は理由コメント付き・main ソース禁止。

### [Medium] 規則ファイルに『実例（2026-08-21）』の事故談が埋め込まれている

- 場所: `monowa/.claude/skills/ddd/references/question-format.md:55`（history）
- 根拠: question-format.md:55-57 `実例（2026-08-21）: 「そもそも出来事ではない / 在籍していれば MonoWa 上の社員である。[HS-042] を撤回する」という選択肢が選ばれ、**エキスパートが言っていない撤回まで記録された**。訂正に 1 往復かかった。` / CLAUDE.md:217-219 `（実例: 2026-08-21 に撤回した「操作を段階で隠さない・無効にしない」は、20260816-02 に「判断は要らないが、記録として」と書かれ、確認を取らないまま規約として扱われていた）`
- なぜ問題か: 規則（1 選択肢に主張を 2 つ束ねない／ai-notes を根拠にしない）は事故談なしで十分検査可能。事故談は製品固有で Cradle の配布物に載せられず、載せると別製品で意味不明になる。
- 直し方: 規則文だけ残し、実例は `documents/ai-notes/` の postmortem に移す（リンクも不要）。lint は finding #2 の日付 grep を `.claude/**` と CLAUDE.md に適用、`実例` を警告語に加える。
- Cradle の規則: ハーネスの規則には事故の実例・日付を書かない。規則は「何を・どう検査するか」で完結させ、経緯は postmortem に分離する。

### [Low] 06_lint.md が起動クラスのファイル名を MonoWaApplication.kt と書くが実ファイルは Application.kt

- 場所: `monowa/documents/codestyle/06_lint.md:64`（drift）
- 根拠: 06_lint.md:64 `com.monowa 直下の起動クラス（MonoWaApplication.kt）だけは Spring Boot の定石として理由コメント付きの @Suppress で例外にしてある。` — 実体は `backend/src/main/kotlin/com/monowa/Application.kt`（クラス名 `MonoWaApplication`）
- なぜ問題か: 小さな不一致だが、finding #1 の参照実在検査が拾える種類。ファイル名とクラス名の不一致自体もリネーム漏れの痕跡。
- 直し方: 文書を `Application.kt` に直すか、ファイルを `MonoWaApplication.kt` に改名して一致させる。CI は finding #1 のパス検査で捕捉。
- Cradle の規則: 文書中のファイル名は実在検査の対象にする。Kotlin のトップレベル単一クラスはファイル名とクラス名を一致させる（ktlint `filename` ルールを有効化）。

### [Low] README に手計算の数量（現在 0・10 組・15 本）がハードコードされている

- 場所: `monowa/lean/README.md:189`（slop）
- 根拠: lean/README.md:189 `grep -rn "sorry" MonoWa/ Main.lean                  # 未証明の残数（現在 0）` L278 `いま入っている 10 組（overdue-remind 以外はどれも scenario: "basic"）:` / e2e/README.md:26 `フローのカタログ(人物・操作・品目ラベルの並び — 15 本)` / 08_comments.md:98 `（残存 0）`（偽）
- なぜ問題か: 数はコマンドで得られるのに文書に写すと、次の変更で必ず古くなる（08 の「残存 0」はすでに偽）。読者は数を信じて確認を省く。
- 直し方: 「現在 0」「10 組」「15 本」を削り、確認コマンド（`ls lean/golden | wc -l`、`grep -c "id: '" e2e/src/model/flows.ts`）だけ残す。lint: `grep -nE '（現在 [0-9]+）|[0-9]+ (本|組|件)\)' README.md */README.md`。
- Cradle の規則: 文書に「現在 N 件」のような計算可能な数量を書かない。数はコマンドで示し、必要なら CI で文書の数と実数を突合する。

### [Low] WHERE で除外済みの状態に対する防御的 coalesce と「起きない」コメント

- 場所: `monowa/backend/src/main/kotlin/com/monowa/application/usecase/relationshipsusecase/RelationshipsQueryServiceImpl.kt:36`（slop）
- 根拠: L36-42 `// 所属が引けない社員は「越えていない」に倒す （参照整合が保たれていれば起きない）。 val cross = DSL.coalesce(DSL.field(lenderSide.DEPARTMENT_ID.ne(borrowerSide.DEPARTMENT_ID)), DSL.inline(false))` — 直後の L55-56 `.and(lenderSide.ACTIVE.isTrue).and(borrowerSide.ACTIVE.isTrue)` で LEFT JOIN の NULL 行は除外されるため coalesce は到達不能
- なぜ問題か: 「起きない」と書きながら黙って false に倒す分岐は、モデルの `Snapshot.refs`（参照整合）違反を隠す方向に働く。`BoardBacking.kt:40` の「黙って辻褄を合わせない」方針と逆。
- 直し方: coalesce を外し `lenderSide.DEPARTMENT_ID.ne(borrowerSide.DEPARTMENT_ID)` を直接使う（inner join 相当に整理）。ヒューリスティック: `grep -rnB2 -A2 '起きない\|ありえない\|should not happen\|never happens' backend/src/main` で、直後に fallback（coalesce / ?: / else -> default）があれば警告。
- Cradle の規則: 「起きない」と書いたケースにフォールバック値を用意しない。到達不能と主張する分岐は削除するか、到達したら例外にする（黙って既定値に倒さない）。

### [Low] agent 定義が infra/README のペルソナ表と WCAG 計算スクリプトを複製している

- 場所: `monowa/.claude/agents/frontend-ux-reviewer.md:131`（redundancy）
- 根拠: frontend-ux-reviewer.md:131-138 `| aoi（社員 1・開発部） | 既定。貸す側として一巡する | … | dan（社員 4・人事） | **上位陣**。#/relationships が見られる唯一の人 |` — `infra/README.md:65-69` の同じ 6 人の表と重複し、「誰がいるかは login.html が決める」（frontend/README.md:58）に反して agent が人を焼き込む。L207-222 に python の WCAG 比計算を埋め込み
- なぜ問題か: `login.html` の人が増減しても agent の表は更新されない。380 行の agent は毎回コンテキストを消費し、製品固有の表を含むため Cradle で再利用できない。
- 直し方: ペルソナ表を削って「`infra/envs/local/idp/login.html` を読んで人を選べ」に置換。WCAG 計算は `e2e/scripts` かスキル `assets/` にスクリプトとして置き、agent は呼び出しだけ書く。
- Cradle の規則: agent/skill 本文にデータ表（利用者一覧・環境一覧）やスクリプト本体を埋め込まない。データは正本ファイルを参照させ、スクリプトは assets に置いて呼ぶ。

### [Low] ai-notes に superseded な検討が「解決済み」注記付きで残り、機械可読な状態がない

- 場所: `monowa/documents/ai-notes/20260816-02-frontend-transport.md:9`（docs）
- 根拠: 20260816-02:9-18 `## FE-Q-001: …（**解決済み — 2026-08-16**） > **決着**: … > 以下は判断前の記録。` / 20260901-02:7-13 `> **2026-09-01 追記（同日）**: この検討は…本メモの「案 B…推奨」は**不採用**。` / 20260821-04 タイトル `（解決済み）` / 25 ファイルすべてに同一の 3 行バナー `> **これは規約ではありません。**…` / 20260816-05:104-106 `CLAUDE.md は API ドキュメントを documents/api.md と記載しているが…古い可能性がある`（既に修正済み）
- なぜ問題か: ai-notes は非規範と宣言されているので放置自体は方針どおりだが、open/superseded が本文の散文にしか無いため「まだ判断待ちの問い」を機械的に列挙できない。バナーはテンプレートで付けるべきもので、コピーで 25 回書かれている。
- 直し方: 各 note に frontmatter（`status: open|resolved|superseded`, `superseded_by:`）を必須にし、バナーはスキルが生成する。`/ddd status` 相当で `status: open` の note を一覧できるようにする。lint: frontmatter 欠落を検出。
- Cradle の規則: 申し送り（ai-notes）は frontmatter で status/superseded_by を持ち、本文の注記で状態を表現しない。非規範バナーは手で書かずテンプレートから生成する。

### [Low] hotspots.md の ID 順が崩れ（HS-040/041 が HS-004 の直後、HS-038・HS-061 が末尾側）、取り消し線で撤回を表現

- 場所: `monowa/documents/ddd/hotspots.md:13`（docs）
- 根拠: L12 `| HS-004 |` L13 `| HS-040 |` L14 `| HS-041 |` L15 `| HS-005 |` … L59 `| HS-038 |`（HS-051 の後） L76 `| HS-061 |`（HS-068 の後） / L52 HS-045 `~~貸し借りには関わらない~~、MonoWa の面倒を見る担当がいて…**2026-08-21 訂正 [HS-056]**`
- なぜ問題か: explorer が「関連の近くに挿入」した結果、ID が単調でなく機械的な差分・参照確認（次の ID・欠番）がしづらい。取り消し線と本文内訂正は、resolved 列に「最新の結論」だけを置く原則から外れる。
- 直し方: ID 昇順を lint（`grep -oP 'HS-\d+' | sort -c`）で強制し、関連は「関連」列で表す。撤回は取り消し線でなく「解決」列を最新結論に書き換え、旧結論は関連 HS 側に残す。
- Cradle の規則: ID 付き台帳（hotspots/ux/mq）は ID 昇順・追記のみとし、CI で単調性を検査する。撤回は取り消し線ではなく最新結論の書き換えで表す。

### [Low] settings.json のフックが JSON 文字列の中に運用ポリシー文を埋め込んでいる

- 場所: `monowa/.claude/settings.json:9`（config）
- 根拠: L9 `"command": "cmd=$(jq -r …); if printf … | grep -qE \"(^|[&|;]\\s*)…gradlew…build…\"; then jq -n \"{decision:\\\"block\\\",reason:\\\"./gradlew build が成功しました。次に sql-perf-review スキルを起動し…High/Medium の指摘が出た場合は提示するだけで終わらせず、その場で修正すること。…\\\"}\"; fi"` — 1 行にシェル・正規表現・日本語ポリシーが多重エスケープで同居
- なぜ問題か: ポリシー文（何をレビューし何を直すか）が JSON の中に閉じ込められ、grep もレビューもしにくい。Cradle で配布するとエスケープの差で壊れやすい。
- 直し方: フックは `.claude/hooks/after-gradle-build.sh` を呼ぶ 1 行にし、判定正規表現とメッセージはスクリプト側（またはメッセージ用 .md）に置く。lint: settings.json の `command` 値が 200 文字を超えたら警告。
- Cradle の規則: hooks の `command` は外部スクリプト呼び出しだけにし、判定ロジックとユーザー向け文言はスクリプト/テキストファイルに置く。

### [Low] ファイル末尾に「置いていない変換」を説明する孤立コメント

- 場所: `monowa/backend/src/main/kotlin/com/monowa/infrastructure/LoanRepositoryImpl.kt:302`（slop）
- 根拠: L302-305 `/* 暦の値は **DB の DATE 列とそのまま同じ型**になった（ドメインの Date は Std.Time.PlainDate = java.time.LocalDate）。境界で詰め替えていた変換は恒等なので置かない。 */` — 直前の関数にも後続の宣言にも紐づかない末尾コメント。L81-83 の KDoc も `（分けて書いていたときは書き換えの側が origin / lender / borrower / item を落としていた — 生成された契約テストの…が検出した）` と修正済みバグの経緯を残す
- なぜ問題か: 「無いもの」の説明と修正済みバグの物語はコードの理解に寄与せず、次の読者に「昔は何かあった」という不安だけ残す。コミットメッセージが持つべき情報。
- 直し方: L302-305 を削除、L81-83 の括弧内経緯を削除（「列の並びは 1 つだけにして食い違えないようにする」だけ残す）。ヒューリスティック: ファイル末尾のブロックコメントで直後に宣言が無いものを検出（`awk` で最後の非空行が `*/` なら警告）。
- Cradle の規則: コードコメントは直後の宣言を説明するものに限り、宣言を伴わない末尾コメント・「置かない/消した」ものの説明・修正済みバグの経緯を書かない（経緯はコミットメッセージへ）。

### [Low] モデルの固定（Opus）が frontmatter と本文の両方に書かれている

- 場所: `monowa/.claude/skills/frontend-ux-review/SKILL.md:68`（redundancy）
- 根拠: frontend-ux-review/SKILL.md:10 `**レビュー本体はあなたではなく、Opus モデルの専任サブエージェント frontend-ux-reviewer が行う。**` L68-69 `モデルはエージェント定義側で Opus に固定されているので、model パラメータは渡さなくてよい。` L84 フォールバックで `model: "opus"` を再指定 / sql-perf-review/SKILL.md:11, 37-38, 49 同型 / agents の frontmatter `model: opus`
- なぜ問題か: モデル名はもっとも変わりやすい設定で、3 か所に書けば必ずずれる。Cradle の配布物にモデル名を焼くと、利用者の契約や将来のモデルに合わない。
- 直し方: 本文からモデル名を消し、「モデルはエージェント定義の frontmatter に従う」とだけ書く。フォールバックの `model:` も「エージェント定義の model を写す」に。lint: `grep -rniE 'opus|sonnet|haiku|fable' .claude/**/SKILL.md CLAUDE.md`。
- Cradle の規則: モデル名はエージェント frontmatter の `model:` にのみ書き、SKILL 本文・CLAUDE.md には書かない。

### [Low] 太字の過剰使用（lean-conventions.md 155 個/737 行、frontend-ux-reviewer.md 120 個/380 行）

- 場所: `monowa/.claude/agents/frontend-ux-reviewer.md:84`（slop）
- 根拠: `grep -o '\*\*[^*]*\*\*' | wc -l`: lean-conventions.md 155/737 行、frontend-ux-reviewer.md 120/380 行、lean/README.md 65/300 行、CLAUDE.md 63/406 行。例 frontend-ux-reviewer.md:84-87 `**相手は Lean CLI（pnpm dev の既定）にする。VITE_MONOWA_TRANSPORT=rest にしない。** … **共有のローカル DB（monowa-local-postgres）を壊さない**`（1 段落に強調 3 つ）
- なぜ問題か: 3 行に 1 つ太字があると強調は情報を失い、本当に落とせない指示（後片付け・REST にしない）が埋もれる。LLM は太字を優先度シグナルとして読むため、過剰な太字は優先度の平坦化を招く。
- 直し方: 太字は「違反すると壊れる指示」に限定し、密度 10 行に 1 個以下を目安に削る。lint: `awk`/シェルで `bold_count / line_count > 0.1` のファイルを警告。
- Cradle の規則: ハーネス散文の太字は 10 行あたり 1 個以下。強調したい規則は太字ではなく「検査可能な文」（grep や手順）に書き換える。

### [Low] 開発パイプラインが 2 通り（5 段と 6 段）で複数文書に書かれている

- 場所: `monowa/CLAUDE.md:353`（contradiction）
- 根拠: CLAUDE.md:353-354 `documents/codestyle/05_configuration.md の流れ（ドメインモデリング → **インフラ設計** → Lean 化 → lean2kotlin → 実装）` / infra-design/README.md:3-4 同じ 5 段 / 05_configuration.md:38 同じ — 一方 CLAUDE.md:273-281 `/ddd … → インフラ設計 → Lean … → フロントエンド改修 → （人間によるアプリケーションレビュー） → バックエンド改修 → e2e` の 6 段（フロント先行・e2e が終端）
- なぜ問題か: 順序はこの harness の核心（backend が最後である理由が長文で説明されている）。2 系統あると AI はどちらの順序でも正当化できる。
- 直し方: 「開発の順序」を CLAUDE.md の 1 節だけに置き、05_configuration.md・infra-design/README.md はその見出しへの参照にする。lint: `grep -rn '→ .*→ .*→' documents CLAUDE.md` で矢印列を列挙し 1 つに。
- Cradle の規則: プロセス（フェーズの順序）は 1 か所で定義し、他文書はアンカー参照だけにする。矢印列で表現された順序を CI で列挙し重複定義を禁止する。

#### そのまま持ち込んでよい良い実践

- 性能バイパスの意図的な複製に**観測同値性**を KDoc で明記し（`backend/src/main/kotlin/com/monowa/application/usecase/raisehandusecase/LoanEngagementBypass.kt:11-17`）、置き場を ktlint `monowa:bypass-site` で機械検査している — 「同じ形の重複」を slop と区別する根拠が書かれている
- 字面では破れる設計規約（ORM の直叩き・名義の構築箇所・Repository の fake 禁止・Controller は execute だけ）を独自 ktlint ルールに落とし、`documents/codestyle/06_lint.md` がルール ↔ 規約の対応表を持つ
- 本番コードに try/catch の握りつぶし・`!!`・TODO/FIXME・`@ts-ignore`・`eslint-disable`・`: any` が 0 件（grep 確認）。`GlobalExceptionHandler` は `IllegalArgumentException` を捕捉せず 500 にし、全経路を `{code,message}` に寄せている
- テストは InMemory fake を作らず本番実装を実 DB に配線する（`04_testing.md`、`RaiseHandUseCaseImplContractTest.kt`）。フロントの `test/stubApi.ts` は「ドメインを再実装しない」と明記し、控えと固定応答だけを持つ
- ありえない状態を黙って埋めず例外/500 にする（`support/BoardBacking.kt:40-43` の `check`、`api/lean/leanFetch.ts:283-289` の「欠けた事実を黙って埋めない」）
- `lean/MonoWa/Runtime/Command.lean:13-78` を反機能（存在しない操作）の単一レジストリとし、`frontend/README.md` と `20260831-01-api-contract-rationale.md` がそこを参照する構造
- `documents/ai-notes/` を「規約ではない」と CLAUDE.md で明示し、ルール（codestyle / README）と申し送りログを分離している。各 note 冒頭の非規範バナーも一貫している
- 見た目の根拠を `frontend/src/styles/tokens.css` 冒頭に 1 度だけ導出として書き、README はそれを要約する（導出は 1 か所）
- `/ddd` スキルの後片付け手順が `test ! -e` / `grep -rn probe-` / `git status` の機械検査になっている（`.claude/skills/ddd/SKILL.md:101-108`）。実際に `probe-` の残骸は 0 件
- Lean 側の層の壁（Domain が Runtime/Application を import しない・読み取り側が Entity を見ない）を `lean/README.md:185-193` の grep で検査可能にしている
- e2e は「シナリオは ID に頼らない」「生成済み JSON をオラクルにしない」（`e2e/README.md:36-63`）と、不安定さの根拠を実測で書く
- 生成物（`backend/src/generated/`, `frontend/src/api/generated/`）を編集しない・契約は openapi.yaml が正・写し漏れはコンパイルエラーにする、という「型で縛る」方針が README/CLAUDE.md/コードで一致している

