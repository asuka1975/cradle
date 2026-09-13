# lean2kotlin

Lean のドメインモデルから Kotlin の型・interface・契約テストを決定的に生成する。Cradle の backend フェーズが Gradle plugin `dev.lean2kotlin` として使い、このリポジトリと版を共にする。

- **Entity / ふるまい持ちの ValueObject** — interface（フィールド + ふるまい）とテスト側の Fixture
- **UseCase / QueryService / Repository / IdGenerator** — interface のみ（default なし。実装は別ファイル）
- **テスト** — `@[contract]` 定理から演繹した契約テスト、Repository の PBT、golden からの ReadModel の Retrieve。生成テストの実行に Lean は要らない

思想: 「構造は生成、振る舞いの契約は interface と Lean 由来テスト、実装は AI」。モデルが進化したら再生成し、コンパイルエラーと赤いテストが実装の TODO リストになる。設計は [docs/design.md](docs/design.md)。

## 構成

```
lean/            抽出器 — Lake パッケージ `lean2kotlin`（lib `Lean2Kotlin`）。#kotlin_ir が対象の環境を走査して IR JSON を書く
generator/       Gradle plugin dev.lean2kotlin — IR + golden → .kt
scaffold-check/  骨格（cradle-init の Sprout）を通す回帰検査。src/generated/ が生成物のスナップショット
```

利用側の配線は backend-implement スキルの `references/gradle-wiring.md`。

## 対象プロジェクト側の契約

モデルに生成配線は書かない。生成器が読むのは Cradle の規約だけ — 印と固定名・ディレクトリの形は `.apm/instructions/lean-spec.instructions.md`、契約面に置ける型の語彙・固定名（`<Root>.DomainError` / `<Root>RepositoryState` / `<X>IdGeneratorState` / `id`）・binder 規約（`<Root>.Runtime.<binder>`、例外は `binderOverrides`）・観測モデルの制約（`<Root>RepositoryState` の Prop フィールド）は `lean-domain-model` スキルの `references/lean-conventions.md` §4 / §9。

## 検査

```bash
(cd generator && ./gradlew test)        # 生成器の単体テスト（Lean 不要）
(cd scaffold-check && ./gradlew test)   # 骨格の抽出 → 生成 → 契約テスト（elan と JDK 21）
```
