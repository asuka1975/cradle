# scaffold-check — 骨格を生成器に通す回帰検査

Cradle の骨格（`.apm/skills/cradle-init/assets/lean`、名前空間 `Sprout`）を `build/scaffold/lean` に写し、Gradle plugin `dev.lean2kotlin` で抽出 → 生成 → コンパイル → 生成された抽象契約テスト 7 本を InMemory 実装（`src/main`。Repository は観測モデルの一意制約を実 DB と同じく例外で守る）と具象サブクラス（`src/test`）で通す。配線は消費側と同じ形（生成器はこのリポジトリの `lean2kotlin/` を `includeBuild`。別の checkout は `LEAN2KOTLIN_HOME`）。

回し方: `cd lean2kotlin/scaffold-check && ./gradlew --no-daemon test`（elan と JDK 21 が要る。`.lake` は抽出器側 `lean2kotlin/lean/.lake` と写し側 `build/scaffold/lean/.lake` にでき、`assets/lean` の下にはできない）。

`src/generated/` はコミットする — 生成器の出力の実物スナップショットで、生成の変化が PR の diff に見える。CI は再生成して `src/generated` に差分（未追跡を含む）が無いことを確かめる。

`port/` は子プロジェクトで、外部能力の Port を持つ最小ドメイン「ロビーの来訪受付」（`port/lean`、名前空間 `Lobby`。CLI・モックアップ・golden は持たない）を同じ経路で通す。Port の interface・要求と観測の型・契約テスト用モックの生成、Port を使う UseCase の契約テスト、短い名前の DomainService、上限つきの制約（`atMostOneExpected`）の回帰素材で、`port/src/test` の `WrongPortUseTest` は Port の使い方を誤った実装（呼ばない・違う要求・2 回・validate より先・失敗の握りつぶし）が生成テストで赤くなることを確かめる。決済（来訪の精算）は副作用の縦断例: 利用者の開始（`StartPaymentUseCase`）、内部入力（`Observation`）で動く配送・確定の通知・照会（`DispatchPaymentUseCase` / `ConfirmPaymentUseCase` / `InquirePaymentUseCase`。名義を受けない）、2 操作を持つ Port（`PaymentGateway`）、消費位置つきの障害契約（送る前・応答喪失・反映の commit 前）の素材で、`WrongDispatchTest` は送る印を保存する前に送る実装が 3 つの中断点で赤くなることを確かめる。`cradle.json` は `lean-check` をこの素材に掛けるためのもの。`port/src/adapterTest` は生成された Adapter の適合テスト（`kotlin-adapter-test`）に stub 相手の Adapter を配線し、`./gradlew :port:adapterContractTest` で回す（`test` の門には入らない）。`port/src/generated/` も同じくスナップショット。
