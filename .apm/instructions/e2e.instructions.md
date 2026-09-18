---
description: E2E の規約 — Lean と REST の画面パリティ、golden から台本を起こす
applyTo: "e2e/**"
---

# E2E（Lean × REST の一致）

- 目的は「人間が Lean CLI 相手の画面で確かめた挙動」と「追随させた backend（REST）」が同じ観測を返すこと。両方をその場で走らせて突き合わせる。記録済み JSON をオラクルにしない。
- 台本は golden の trace から起こす（`e2e-parity` スキルの `flows-from-golden`）。人物・手・通った / 断られた・そのとき見えたものは golden が正。画面の操作への写しだけを手で書く。
- 手書きの台本は、手の列（command・actor・outcome）が golden の流れと同じ順で一致するときだけ台本として数える（`flows-from-golden --check`。置き場は `cradle.json` の `e2e.scenarios`）。
- 拒否（domainError）の手も台本に含める。自動で起きる帰結（番回しなど）を辿る流れを落とさない。
- シナリオは ID に頼らず、ラベル + 当事者で紙面を特定する。日付は相対指定。
- REST 側の初期盤面は golden の init state から REST 経由で播種する。テスト用 DB は開発ループと分ける。
- フローが作った行は次のフローの前に消す（播種した seed だけを残す）。状態がフロー間で漏れると再現しない失敗になる。
- `workers: 1`。固定スリープで同期しない — DOM の変化（新しい通知ノード・ネットワークの静けさ）を待つ。
- local スタックは infra-implement フェーズの成果物。`infra.up` で立て、`cradle doctor --local` が fresh であることを先に確かめる。
- 差分が出たら「backend の追随漏れ」か「モデルの見直し」かを切り分ける。後者は Lean に戻る。
