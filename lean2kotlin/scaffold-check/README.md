# scaffold-check — 骨格を生成器に通す回帰検査

Cradle の骨格（`.apm/skills/cradle-init/assets/lean`、名前空間 `Sprout`）を `build/scaffold/lean` に写し、Gradle plugin `dev.lean2kotlin` で抽出 → 生成 → コンパイル → 生成された抽象契約テスト 7 本を InMemory 実装（`src/main`。Repository は観測モデルの一意制約を実 DB と同じく例外で守る）と具象サブクラス（`src/test`）で通す。配線は消費側と同じ形（生成器はこのリポジトリの `lean2kotlin/` を `includeBuild`。別の checkout は `LEAN2KOTLIN_HOME`）。

回し方: `cd lean2kotlin/scaffold-check && ./gradlew --no-daemon test`（elan と JDK 21 が要る。`.lake` は抽出器側 `lean2kotlin/lean/.lake` と写し側 `build/scaffold/lean/.lake` にでき、`assets/lean` の下にはできない）。

`src/generated/` はコミットする — 生成器の出力の実物スナップショットで、生成の変化が PR の diff に見える。CI は再生成して `src/generated` に差分（未追跡を含む）が無いことを確かめる。
