---
description: インフラの規約 — 設計の正本は documents/infra-design、モデルに裏付けの無いものを作らない
applyTo: "infra/**,documents/infra-design/**,backend/Dockerfile,frontend/Dockerfile"
---

# インフラ

- 設計の正本は `documents/infra-design/`（決定 INFRA-D / 前提 INFRA-A / 未決 INFRA-Q）。`infra/` は実装、README は手順だけ。構成を変えたら設計も直す。
- モデルに裏付けの無いインフラを足さない（スケジューラ・ジョブキュー・メール・オブジェクトストレージ・削除バッチ…）。「作らないもの」の一覧を設計に持つ。必要になったら /ddd に戻す。
- 環境は test（外部依存なし）/ local（本番同等、コンテナ）/ prod の 3 つ。検証を飛ばすプロファイルを作らない。local にも本番と同じ経路のモック発行者を置く。
- モデルの横断不変条件の直列化点は DB に一本化する。複数タスク常駐を前提にし、スキーマ初期化の競合（同時起動で `CREATE TABLE` が衝突）を起こさない — マイグレーションは 1 回だけ流す。
- 時刻は全層 UTC 固定。E2E のための時計固定（faketime）は local のイメージだけに焼き、backend と発行者を同期させる。本番の攻撃面に持ち込まない。
  faketime の値は `@` 前置で時を進め続ける（絶対時刻だけだと時計が止まり起動が終わらない）。初期値は volume でなくコンテナ作成時の配置で書く（値を変えても古い volume が残る）。切り替えるたびに前段（nginx）を再起動する（古い upstream を掴む）。JVM の起動は大きく遅くなる（分単位）。
- 前段（CDN / nginx）で `/api/*` を backend に振り same-origin を保つ。API 経路のエラー契約を前段が書き換えない（SPA フォールバックを `/api` に効かせない）。
- 秘密は state・ログ・リポジトリに載せない。TLS の既定を fail-open にしない（証明書未設定で平文に倒れる既定値を置かない）。
- 最小権限（非 root コンテナ、必要な IAM だけ、既定で ECS Exec を開けない）。利用者の同一性の器（ユーザープール等）は削除保護を付ける。
- 監視は 5xx 率・応答時間・稼働数・ログ由来エラーのアラームと通知先。
- 本番イメージは CI で焼く。開発者端末とリポジトリ外の依存に頼らない。
- local スタックは `cradle.json` の `infra.up` の 1 コマンドで立てる。コンテナ名を `infra.containers` に書き、作り直しの前に `cradle doctor --local` で鮮度（Created と HEAD の時刻）を確かめる。
