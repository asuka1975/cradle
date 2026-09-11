---
name: cradle-status
description: Use when the product owner asks where the project stands, what to do next, or which phase of the Lean spec-driven pipeline is current — runs cradle status and proposes exactly one next step.
---

# 現在地と次の一手

`cradle status`（`node <skills>/cradle/scripts/cradle.mjs status`）を実行し、出力をそのまま示したうえで、
次の一手を 1 つだけ提案する。複数のフェーズが進行中なら、順序（探索 → インフラ設計 → Lean → 画面 → 人間の確認 → バックエンド → インフラ実装 → E2E → 本番投入）の上流を優先する。
open の MQ があれば、それが形式化を止めている問いであることを添える。
