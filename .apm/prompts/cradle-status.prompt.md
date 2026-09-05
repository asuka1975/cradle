---
description: パイプラインの現在地と次の一手を、プロダクトオーナー向けに示す
allowed-tools: [Bash, Read]
---

`node .claude/skills/cradle/scripts/cradle.mjs status` を実行し、出力をそのまま示したうえで、
次の一手を 1 つだけ提案する（複数のフェーズが進行中なら、順序（探索 → インフラ設計 → Lean → 画面 → 人間の確認 → バックエンド → E2E）の上流を優先する）。
open の MQ があれば、それが形式化を止めている問いであることを添える。
