// footer.js（lean.js の末尾に足す JS の口）の単体テスト。wasm の代わりに同じ形の小さな偽物を渡す（emcc は要らない）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const footer = readFileSync(fileURLToPath(new URL("../.apm/skills/cradle/assets/wasm/footer.js", import.meta.url)), "utf8");
const REQ = 16, RES = 32n;

// 偽のモジュール。呼ばれ方を log に残す。over で 1 つだけ振る舞いを変える
function harness(over = {}) {
  const log = { created: 0, calls: [], freed: [] };
  const context = {
    createCradleLeanModule: async () => {
      log.created++;
      return {
        _cradle_init: () => 0,
        stringToNewUTF8: () => REQ,
        lengthBytesUTF8: (s) => Buffer.byteLength(s),
        _cradle_call: (req, size) => { log.calls.push([req, size]); return RES; },
        UTF8ToString: () => '{"ok":1}',
        _free: (p) => { log.freed.push(p); },
        ...(typeof over === "function" ? over(log) : over),
      };
    },
  };
  vm.runInNewContext(footer, context);
  return { log, open: () => context.createCradleLean() };
}

test("応答を文字列で返し、リクエストと応答のメモリを返す", async () => {
  const { log, open } = harness();
  const lean = await open();
  assert.equal(await lean("{}"), '{"ok":1}');
  assert.deepEqual(log.freed, [BigInt(REQ), RES]);
  assert.equal(log.created, 1);
});

test("リクエストの長さは UTF-8 のバイト数で渡す（NUL で切らない）", async () => {
  const { log, open } = harness();
  const lean = await open();
  await lean("a\0あ");
  assert.deepEqual(log.calls, [[BigInt(REQ), 5n]]);
});

test("リクエストを置けなければ Lean を呼ばず、エラーの形で返し、次の呼び出しで作り直す", async () => {
  let first = true;
  const { log, open } = harness({ stringToNewUTF8: () => { const r = first ? 0 : REQ; first = false; return r; } });
  const lean = await open();
  assert.deepEqual(JSON.parse(await lean("{}")), { error: "Lean の wasm が止まりました: リクエストを置くメモリが足りません" });
  assert.deepEqual(log.calls, []);
  assert.equal(log.created, 1);
  assert.equal(await lean("{}"), '{"ok":1}');
  assert.equal(log.created, 2);
});

test("応答を置けなければ（NULL）空文字にせずエラーの形で返し、次の呼び出しで作り直す", async () => {
  let first = true;
  const { log, open } = harness({ _cradle_call: () => { const r = first ? 0n : RES; first = false; return r; } });
  const lean = await open();
  assert.deepEqual(JSON.parse(await lean("{}")), { error: "Lean の wasm が止まりました: 応答を置くメモリが足りません" });
  assert.equal(await lean("{}"), '{"ok":1}');
  assert.equal(log.created, 2);
});

test("Lean が止まったらエラーの形で返し、止まったインスタンスは使わない", async () => {
  let first = true;
  const { log, open } = harness({ _cradle_call: () => { if (first) { first = false; throw new Error("Maximum call stack size exceeded"); } return RES; } });
  const lean = await open();
  assert.deepEqual(JSON.parse(await lean("{}")), { error: "Lean の wasm が止まりました: Maximum call stack size exceeded" });
  assert.deepEqual(log.freed, []);   // 止まったインスタンスのメモリには触らない
  assert.equal(await lean("{}"), '{"ok":1}');
  assert.equal(log.created, 2);
});

test("初期化に失敗したら作らずに投げる", async () => {
  const { open } = harness({ _cradle_init: () => 1 });
  await assert.rejects(open(), /初期化に失敗/);
});
