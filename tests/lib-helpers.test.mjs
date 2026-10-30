// lib.mjs の小道具（複数の道具が共有する読み方・数え方）の単体テスト。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tempDir, writeTree } from "./helpers.mjs";
import { sha256, walk, leanSnapshot } from "../.apm/skills/cradle/scripts/lib.mjs";

test("sha256 は文字列と同じ中身の Buffer に同じ 16 進を返す", () => {
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256(Buffer.from("探索", "utf8")), sha256("探索"));
  assert.equal(sha256(""), createHash("sha256").update("").digest("hex"));
});

test("walk の既定はビルド成果物と VCS の置き場を見ない。leanSnapshot はそれに lake-manifest.json を足す", (t) => {
  const root = tempDir(t, "cradle-walk-");
  writeTree(root, {
    "lean/A.lean": "a", "lean/lake-manifest.json": "{}",
    "lean/.lake/x": "", "lean/node_modules/x": "", "lean/build/x": "", "lean/.git/x": "", "lean/dist/x": "",
  });
  assert.deepEqual(walk(join(root, "lean")), [join(root, "lean", "A.lean"), join(root, "lean", "lake-manifest.json")]);
  assert.deepEqual(leanSnapshot({ lean: { rootDir: join(root, "lean") } }), { "A.lean": sha256("a") });
});
