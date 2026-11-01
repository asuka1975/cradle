// footer.js（lean.js の末尾に足す JS の口）の単体テスト。wasm の代わりに同じ形の小さな偽物を渡す（emcc は要らない）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const footer = readFileSync(fileURLToPath(new URL("../.apm/skills/cradle/assets/wasm/footer.js", import.meta.url)), "utf8");
const REQ = 16, RES = 32n;

// 偽のモジュール。呼ばれ方を log に残す（requests は Lean に届いたバイト列）。over で 1 つだけ振る舞いを変える
// 型は -sMEMORY64=2 の実物に揃える: _malloc は Number を返し、_cradle_call は BigInt だけを受けて BigInt を返す
function harness(over = {}) {
  const log = { created: 0, calls: [], requests: [], freed: [] };
  const context = {
    TextEncoder,
    createCradleLeanModule: async () => {
      log.created++;
      const m = {
        HEAPU8: new Uint8Array(256),
        _cradle_init: () => 0,
        _malloc: () => REQ,
        _cradle_call: (req, size) => {
          if (typeof req !== "bigint" || typeof size !== "bigint") throw new TypeError(`Cannot convert ${req} to a BigInt`);
          log.calls.push([req, size]);
          log.requests.push([...m.HEAPU8.subarray(Number(req), Number(req) + Number(size))]);
          return RES;
        },
        UTF8ToString: () => '{"ok":1}',
        _free: (p) => { log.freed.push(p); },
      };
      return Object.assign(m, typeof over === "function" ? over(m) : over);
    },
  };
  vm.runInNewContext(footer, context);
  return { log, open: () => context.createCradleLean() };
}
const utf8 = (s) => [...new TextEncoder().encode(s)];

test("応答を文字列で返し、リクエストと応答のメモリを返す", async () => {
  const { log, open } = harness();
  const lean = await open();
  assert.equal(await lean("{}"), '{"ok":1}');
  assert.deepEqual(log.freed, [BigInt(REQ), RES]);
  assert.equal(log.created, 1);
});

test("リクエストはバイト列の長さごと渡す（NUL で切らない）", async () => {
  const { log, open } = harness();
  const lean = await open();
  await lean("a\0あ");
  assert.deepEqual(log.calls, [[BigInt(REQ), 5n]]);
  assert.deepEqual(log.requests, [utf8("a\0あ")]);
});

test("単独サロゲートは CLI の stdin と同じ U+FFFD にし、続く文字を落とさない", async () => {
  const { log, open } = harness();
  const lean = await open();
  for (const text of ["\ud800あ", "\udc00あ", "\ud800\ud800あ", "\ud800A", "😀あ"]) {
    log.requests.length = 0;
    await lean(text);
    assert.deepEqual(log.requests, [[...Buffer.from(text, "utf8")]], JSON.stringify(text));
  }
});

test("空のリクエストでも 1 バイトは確保して NULL と紛らせない", async () => {
  const sizes = [];
  const { log, open } = harness({ _malloc: (n) => { sizes.push(n); return REQ; } });
  const lean = await open();
  assert.equal(await lean(""), '{"ok":1}');
  assert.deepEqual(sizes, [1n]);
  assert.deepEqual(log.calls, [[BigInt(REQ), 0n]]);
});

test("確保でメモリが伸びて HEAPU8 が作り直されても、新しい方に書く", async () => {
  const { log, open } = harness((m) => ({ _malloc: () => { m.HEAPU8 = new Uint8Array(1024); return REQ; } }));
  const lean = await open();
  await lean("abc");
  assert.deepEqual(log.requests, [utf8("abc")]);
});

test("リクエストを置けなければ Lean を呼ばず、エラーの形で返し、次の呼び出しで作り直す", async () => {
  let first = true;
  const { log, open } = harness({ _malloc: () => { const r = first ? 0 : REQ; first = false; return r; } });
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
