/-
  ドメインモデル CLI — `spec-query`・`golden-check` が叩くネイティブの入口。

    stdin  : JSON 1 つ / stdout : JSON 1 つ（1 リクエスト 1 プロセス）

  プロトコルの中身は Sprout/Runtime/Protocol.lean の `handle`（ブラウザの wasm も同じ 1 本を通る）。ここは入出力だけ。
-/
import Sprout.Runtime.Protocol

def main : IO Unit := do
  IO.println (handle (← (← IO.getStdin).readToEnd)).compress
