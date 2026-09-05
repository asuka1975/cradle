---
name: backend-implement
description: Use when it is time to make the backend follow the Lean model — regenerate Kotlin from Lean, implement the generated interfaces (UseCase, QueryService, Repository, Entity), wire every generated contract test, make the build green, then run the design and SQL reviews. Backend comes after the human confirmed the screens.
---

# バックエンド追随

順序の確認から始める: `cradle status` で「人間による画面確認」が済んでいるか。済んでいなければ着手しない（バックエンドは最後）。

## 手順

0. **初回だけ**: `node .claude/skills/cradle-init/scripts/init.mjs --project <Root> --backend <package>` で ktlint 独自ルール・`.editorconfig`・`gradle.properties` を敷き、`references/gradle-wiring.md` の断片で lean2kotlin・OpenAPI・jOOQ・ktlint を配線する。
1. **影響範囲**: `cradle regen-impact`。変わった生成シンボル・参照する手書き実装・未配線の契約テスト・golden 回帰を読む。想定外の広がりは設計の見直しのサイン（ユーザーに示す）。
2. **コンパイルエラーが TODO リスト**: `./gradlew compileKotlin compileTestKotlin`。消えた interface・変わった署名を追随する。
3. **実装**（規約は `.claude/rules/backend-kotlin.md` / `backend-design.md`）:
   - UseCase: 固定形（validate が解決、execute が validate を呼んで作用、境界は execute）。
   - QueryService: jOOQ 直叩き、並び・絞り込みは DB。共有ヘルパを作らない。
   - Repository: 契約の写し。横断不変条件の直列化点（一意制約 / `FOR UPDATE` / version）を DB に置く。
   - Entity / VO: 生成 interface の実装。不変で新インスタンスを返す。
   - 性能バイパスは宣言（UseCase のディレクトリ）と実装（infrastructure）を分け、観測同値を KDoc に。
4. **契約テストの配線**: 生成された抽象契約テスト**すべて**に具象サブクラス（本番実装を実 DB に配線。fake 禁止。骨格は `cradle contract-skeleton <生成ファイル>`）。`cradle status` の「契約テスト 配線 n/m」が m/m になるまで。
   生成ログの note（golden 0 件・語彙の壁で生成されなかった契約）は失敗として扱い、モデルか fixture に戻す（分類と戻り先は `references/gradle-wiring.md`）。
   生成された PBT が実スキーマで通らない（生成値が大域不変条件を満たさない）ときは、`@Disabled` や InMemory で通さない。三択（モデルの型を見直す / 永続化の表現を変える / 配線を見送る）を ai-note に書いてユーザーに委ねる。
5. **境界と門のテスト**: HTTP レベルで 401 / 403 / 404 / 422 の経路、トランザクションの巻き戻し（割った境界は両方向）。
6. `./gradlew build`（ktlint 込み）。通ったら hook の指示どおり `sql-perf-review` と `backend-design-review`。High / Medium は直す。
7. `cradle unslop --diff`。ai-notes に残す判断（設計判断・性能以外の選択）があれば書き置く。

## 決めごと

- モデルが定めた判断（並び順・可否・遷移）を Kotlin で再導出しない。足りなければ Lean の View / validate に足して再生成する。
- 生成された `Resolved` 型を崩さない（validate の戻り型を勝手に変えない）。
- 泉（IdGenerator）の消費順はモデルの契約。先行消費しない。
