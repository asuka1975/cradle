---
name: regen-impact
description: Use after the Lean model changed and before touching backend code — regenerates Kotlin from Lean, lists changed generated symbols, the hand-written files and contract tests that reference them, and golden regressions, so the blast radius is known before implementation.
---

# 再生成の影響範囲

Lean を変えたら、実装に着手する前に影響範囲を機械で出す。

```bash
cradle regen-impact            # 再生成 → 差分 → 参照元 → golden 回帰
cradle regen-impact --dry-run  # 見るだけ（生成ディレクトリを元に戻す。クリーンなときだけ）
cradle regen-impact --no-regen # 作業ツリーの生成物の差分だけを読む
```

## 読み方

1. **生成物の差分**: 変わった / 増えた / 消えたファイル。消えた interface は実装クラスがコンパイルできなくなる（それが TODO リスト）。
2. **影響を受ける手書きコード**: 変わったシンボルを参照する `src/main` / `src/test`。ここが追随の対象。
3. **参照元の無い生成シンボル**: 新しい interface・契約テスト。これから実装する。
4. **未配線の契約テスト**: 抽象契約テストに具象サブクラスが無いもの（契約テストは `src/test`、Adapter の適合テストは `src/adapterTest` に探す）。配線するまで「テストは無い」。
5. **golden 回帰**: 変えるつもりのなかった流れが変わっていないか。ok 以外の行を golden-check と同じ言い方で並べる。CHANGED は意図した変更かを 1 件ずつ判断し、error・skipped（再生できなかった golden）は `cradle golden-check` で理由を読む。

## 決めごと

- 生成ディレクトリに未コミットの差分がある状態では回さない（どこからどこまでが今回の変更か分からなくなる）。
- `--dry-run` は終わりに（再生成が失敗したときも）生成ディレクトリを HEAD に戻すので、未コミットの差分があれば `--no-regen` でも `--force` でも断る（戻すと元からの差分も消える）。
- 影響範囲の一覧を先にユーザーに示してから実装に入る（想定外の広がりは設計の見直しのサイン）。
- 生成ログの note は失敗として読む。
