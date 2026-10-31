// 要件は Node 20+（README）。Node 20.11 より前に無い import.meta.dirname を、配る道具と統合のコードが使っていないこと。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { walk, rel } from "../.apm/skills/cradle/scripts/lib.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));

test("配る道具と統合のコードは import.meta.dirname を使わない（Node 20.0–20.10 では undefined で、join が投げる）", () => {
  const files = ["../.apm/", "../integrations/", "../scripts/"].flatMap(d => walk(fileURLToPath(new URL(d, import.meta.url)), { ext: [".mjs", ".js", ".ts"] }));
  assert.ok(files.length > 10);
  assert.deepEqual(files.filter(f => readFileSync(f, "utf8").includes("import.meta.dirname")).map(f => rel(repo, f)), []);
});
