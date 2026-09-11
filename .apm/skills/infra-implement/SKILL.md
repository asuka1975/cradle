---
name: infra-implement
description: Use for the infrastructure implementation phase after the backend follows the model — turning documents/infra-design decisions into infra/ (local container stack, production IaC), wiring cradle.json infra.up / infra.containers, adding IaC validate and image build steps to CI, and, once E2E passes, applying production once in a sandbox and recording it in the deployment table. Not for designing infrastructure (infra-design).
---

# インフラ実装

設計（`documents/infra-design/`）を `infra/` に写す。出番は 2 回: local スタックは E2E の前提、本番の apply は E2E 合格の後。
順序の確認から始める: `cradle status` でバックエンドが着手済か。着手済でなければ着手しない。

## 手順

1. **設計を読む**: `documents/infra-design/` の 02_local / 03_production / 04_operations。INFRA-D をそのまま実装に写す。設計に無いものを足さない（足したくなったら infra-design スキルに戻す）。
2. **local**: コンテナ（DB・backend・frontend・モック発行者）を `infra/local/` に置く。`cradle.json` の `infra.up` に立てる 1 コマンド、`infra.containers` にコンテナ名を書く。立てて `cradle doctor --local` が fresh になったら、README の投入表の local を `済（日付）` にする。
3. **CI**: 骨格の `cradle.yml` に段を足す。`infra/` があるときだけ動く形にする。

   ```yaml
   infra:
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
       - uses: hashicorp/setup-terraform@v3
         if: hashFiles('infra/prod/**') != ''
       - run: terraform -chdir=infra/prod fmt -check && terraform -chdir=infra/prod init -backend=false && terraform -chdir=infra/prod validate
         if: hashFiles('infra/prod/**') != ''
       # plan は state と資格情報が要る。持てる環境でだけ足す
       - run: docker build -t <registry>/<app>-backend:${{ github.sha }} backend
         if: hashFiles('infra/**') != ''
   ```

   IaC が Terraform でなければ、その道具の fmt / validate に読み替える。イメージのタグはコミット SHA。
4. **prod**: E2E 合格後、サンドボックスで一度 apply する。`cradle status` のインフラ設計に prod に関わる未決 INFRA-Q が残っていれば apply しない。投入表の prod を `済（日付）` にし、記録に詰まった箇所を 1 行。
5. **設計への戻し**: 実装で前提が変わったら README の「実装後の見直し」に事実だけを書き、設計を直す。

## 決めごと

- IaC のモジュール・compose は Cradle が配らない。書き方は設計（INFRA-D）と infra 規約が決める。
- fail-open の既定・削除保護・アラームの通知先は infra 規約のとおり。実装で緩めない。
- 機械で確かめられるのは `cradle doctor --local`（local の鮮度）だけ。残りは設計と突き合わせて読む。
