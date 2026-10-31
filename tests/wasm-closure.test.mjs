import test from "node:test";
import assert from "node:assert/strict";
import { classify, initSchedule, initSource, initSymbolOf, parseInitBody, parseModule, prunedSource, reach, splitItems, symbolIndex, tokensOf } from "../.apm/skills/cradle/scripts/wasm-closure.mjs";

// Lean が吐く C の形を小さく写した素材。A は別モジュールの関数と起動時の定数を使い、C は誰からも届かない
const moduleA = `// Lean compiler output
// Module: Pkg.A
// Imports: public import Init public import Pkg.B
#include <lean/lean.h>
#ifdef __cplusplus
extern "C" {
#endif
lean_object* l_B_helper(lean_object*);
extern lean_object* l_B_table;
lean_object* l_C_unused(lean_object*);
LEAN_EXPORT lean_object* cradle_handle(lean_object*);
LEAN_EXPORT lean_object* l_A_dead(lean_object*);
static const lean_string_object l_A_msg___closed__0_value = {.m_header = {.m_rc = 0, .m_tag = 249, .m_other = 0, .m_cs_sz = 0}, .m_size = 6, .m_capacity = 6, .m_length = 5, .m_data = "}{;\\"x"};
static const lean_object* l_A_msg___closed__0 = (const lean_object*)&l_A_msg___closed__0_value;
LEAN_EXPORT lean_object* cradle_handle(lean_object* v_x_1_){
_start:
{
lean_object* v_y_2_;
v_y_2_ = l_B_helper(l_B_table);
return ((lean_object*)(l_A_msg___closed__0));
}
}
LEAN_EXPORT lean_object* l_A_dead(lean_object* v_x_1_){
_start:
{
return l_C_unused(v_x_1_);
}
}
lean_object* initialize_Init(uint8_t builtin);
lean_object* initialize_Pkg_B(uint8_t builtin);
static bool _G_initialized = false;
LEAN_EXPORT lean_object* initialize_Pkg_A(uint8_t builtin) {
lean_object * res;
if (_G_initialized) return lean_io_result_mk_ok(lean_box(0));
_G_initialized = true;
res = initialize_Init(builtin);
if (lean_io_result_is_error(res)) return res;
lean_dec_ref(res);
res = initialize_Pkg_B(builtin);
if (lean_io_result_is_error(res)) return res;
lean_dec_ref(res);
return lean_io_result_mk_ok(lean_box(0));
}
#ifdef __cplusplus
}
#endif
`;
const moduleB = `// Lean compiler output
// Module: Pkg.B
// Imports: public import Init
#include <lean/lean.h>
#ifdef __cplusplus
extern "C" {
#endif
LEAN_EXPORT lean_object* l_B_helper(lean_object*);
LEAN_EXPORT lean_object* l_B_table;
LEAN_EXPORT lean_object* l_B_other;
LEAN_EXPORT lean_object* l_B_attr;
static lean_object* _init_l_B_table(void){
_start:
{
return lean_box(1);
}
}
static lean_object* _init_l_B_other(void){
_start:
{
return lean_box(2);
}
}
LEAN_EXPORT lean_object* l_B_initFn(void){
_start:
{
return lean_io_result_mk_ok(lean_box(3));
}
}
LEAN_EXPORT lean_object* l_B_helper(lean_object* v_x_1_){
_start:
{
return v_x_1_;
}
}
lean_object* initialize_Init(uint8_t builtin);
static bool _G_initialized = false;
LEAN_EXPORT lean_object* initialize_Pkg_B(uint8_t builtin) {
lean_object * res;
if (_G_initialized) return lean_io_result_mk_ok(lean_box(0));
_G_initialized = true;
res = initialize_Init(builtin);
if (lean_io_result_is_error(res)) return res;
lean_dec_ref(res);
l_B_table = _init_l_B_table();
lean_mark_persistent(l_B_table);
l_B_other = _init_l_B_other();
lean_mark_persistent(l_B_other);
res = l_B_initFn();
if (lean_io_result_is_error(res)) return res;
l_B_attr = lean_io_result_get_value(res);
lean_mark_persistent(l_B_attr);
lean_dec_ref(res);
res = l_B_register();
if (lean_io_result_is_error(res)) return res;
lean_dec_ref(res);
return lean_io_result_mk_ok(lean_box(0));
}
#ifdef __cplusplus
}
#endif
`;

test("splitItems は文字列の中の波かっこに惑わされず、宣言・データ・関数・前処理行に切り、C++ の囲いを落とす", () => {
  const items = splitItems(moduleA);
  assert.equal(items[0], "#include <lean/lean.h>");
  assert.ok(items.includes("lean_object* l_B_helper(lean_object*);"));
  assert.ok(items.some(i => i.startsWith("static const lean_string_object l_A_msg___closed__0_value") && i.endsWith('.m_data = "}{;\\"x"};')));
  assert.ok(items.some(i => i.startsWith("LEAN_EXPORT lean_object* cradle_handle(lean_object* v_x_1_){") && i.endsWith("}\n}")));
  assert.ok(!items.some(i => i.includes("__cplusplus") || i.startsWith('extern "C"')));
  assert.throws(() => splitItems("void f(){\n"), /波かっこ/);
  assert.throws(() => splitItems("int a"), /末尾を項目に切れない/);
});

test("classify は宣言の名前と実体の有無を読む", () => {
  assert.deepEqual(classify("lean_object* l_f(lean_object*);"), { name: "l_f", def: false, isStatic: false, isFn: true });
  assert.deepEqual(classify("extern lean_object* l_v;"), { name: "l_v", def: false, isStatic: false, isFn: false });
  assert.deepEqual(classify("LEAN_EXPORT lean_object* l_v;"), { name: "l_v", def: true, isStatic: false, isFn: false });
  assert.deepEqual(classify("static bool _G_initialized = false;"), { name: "_G_initialized", def: true, isStatic: true, isFn: false });
  assert.deepEqual(classify("static const lean_object* l_c = (const lean_object*)&l_c_value;"), { name: "l_c", def: true, isStatic: true, isFn: false });
  assert.deepEqual(classify("LEAN_EXPORT lean_object* l_f(lean_object* x){\nreturn x;\n}"), { name: "l_f", def: true, isStatic: false, isFn: true });
  assert.throws(() => classify("= 3;"), /名前を読めない/);
});

test("tokensOf は文字列の中の語を参照と数えない", () => {
  assert.deepEqual([...tokensOf('f(g, "h i")')], ["f", "g"]);
});

test("parseInitBody は import の連鎖を捨て、定数ごとの組に切り、読めない文は投げる", () => {
  const init = splitItems(moduleB).find(i => i.includes("initialize_Pkg_B(uint8_t builtin) {"));
  const parsed = parseInitBody(init);
  // 値を持たない作用（l_B_register）は var が null の組
  assert.deepEqual(parsed.groups.map(g => g.var), ["l_B_table", "l_B_other", "l_B_attr", null]);
  assert.ok(parsed.groups.every(g => !g.lines.join("\n").includes("initialize_Init")));
  assert.throws(() => parseInitBody("LEAN_EXPORT lean_object* initialize_X(uint8_t builtin) {\nsomething_new();\nreturn lean_io_result_mk_ok(lean_box(0));\n}"), /文を読めない: .*something_new/);
});

test("reach は入口から届く関数と定数だけを集め、足りないモジュールを読みに行き、届かないものは呼ばない", async () => {
  const loaded = [];
  const r = await reach({
    roots: ["cradle_handle"],
    modules: [moduleA],
    locate: (s) => ({ l_B_helper: "Pkg.B", l_B_table: "Pkg.B", l_C_unused: "Pkg.C" })[s],
    loadModules: async (names) => { loaded.push(...names); return names.map(n => ({ "Pkg.B": moduleB })[n]); },
  });
  assert.deepEqual(loaded, ["Pkg.B"]);           // l_A_dead が使う Pkg.C は読まない
  assert.deepEqual(r.unresolved, []);
  const names = (m) => [...r.kept.get(m).items].map(i => i.name);
  assert.ok(names("Pkg.A").includes("cradle_handle"));
  assert.ok(!names("Pkg.A").includes("l_A_dead"));
  assert.deepEqual([...r.kept.get("Pkg.B").vars], ["l_B_table"]);
  const a = prunedSource(r.modules.get("Pkg.A"), r.kept.get("Pkg.A"));
  assert.ok(a.includes("cradle_handle(lean_object* v_x_1_){") && a.includes("l_A_msg___closed__0_value"));
  assert.ok(!a.includes("l_A_dead") && !a.includes("l_C_unused"));
  // 初期化子は届いた定数の分だけ。import の連鎖も属性の登録（l_B_attr）も消える
  const b = prunedSource(r.modules.get("Pkg.B"), r.kept.get("Pkg.B"));
  assert.ok(b.includes("l_B_table = _init_l_B_table();") && b.includes("static bool _G_initialized = false;"));
  assert.ok(!b.includes("l_B_other") && !b.includes("l_B_attr") && !b.includes("l_B_register") && !b.includes("initialize_Init"));
  assert.deepEqual(initSchedule(r), ["initialize_Pkg_B"]);
});

test("reach は索引が定義元と言うのに本文に実体が無いシンボルを unresolved にする（配布物と生成物の食い違い）", async () => {
  const r = await reach({ roots: ["l_gone"], modules: [moduleB], locate: () => "Pkg.B", loadModules: async () => [] });
  assert.deepEqual(r.unresolved, ["l_gone"]);
});

test("initSchedule は定数の初期化が届く先の初期化子を先に呼び、同じモジュールは runtime_ → meta_ の順", async () => {
  const mod = (name, body) => `// Module: ${name}\n#include <lean/lean.h>\n${body}`;
  const init = (fn, v) => `static bool _G_${fn} = false;\nLEAN_EXPORT lean_object* ${fn}(uint8_t builtin) {\nlean_object * res;\nif (_G_${fn}) return lean_io_result_mk_ok(lean_box(0));\n_G_${fn} = true;\n${v} = _init_${v}();\nlean_mark_persistent(${v});\nreturn lean_io_result_mk_ok(lean_box(0));\n}\n`;
  const late = mod("Z.Late", `LEAN_EXPORT lean_object* l_late;\nextern lean_object* l_early;\nLEAN_EXPORT lean_object* l_late_fn(void){\nreturn l_early;\n}\nstatic lean_object* _init_l_late(void){\nreturn l_late_fn();\n}\n${init("initialize_Z_Late", "l_late")}`);
  const early = mod("A.Early", `LEAN_EXPORT lean_object* l_early;\nLEAN_EXPORT lean_object* l_meta;\nstatic lean_object* _init_l_early(void){\nreturn lean_box(0);\n}\nstatic lean_object* _init_l_meta(void){\nreturn lean_box(0);\n}\n${init("runtime_initialize_A_Early", "l_early")}${init("meta_initialize_A_Early", "l_meta")}`);
  const r = await reach({ roots: ["l_late", "l_meta"], modules: [late, early], locate: () => undefined, loadModules: async () => [] });
  const order = initSchedule(r);
  assert.deepEqual(order, ["meta_initialize_A_Early", "runtime_initialize_A_Early", "initialize_Z_Late"].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  assert.ok(order.indexOf("runtime_initialize_A_Early") < order.indexOf("meta_initialize_A_Early"));
  assert.ok(order.indexOf("runtime_initialize_A_Early") < order.indexOf("initialize_Z_Late"));
  const c = initSource(order);
  assert.match(c, /lean_object\* cradle_init_modules\(void\)/);
  assert.match(c, /res = initialize_Z_Late\(1\); if \(lean_io_result_is_error\(res\)\) return res;/);
});

// GNU ar のシンボル表を手で組む（メンバーの本体は要らない）
function arWith(members) {
  const syms = members.flatMap((m, i) => m.map(s => [s, i]));
  const names = Buffer.from(syms.map(([s]) => s + "\0").join(""), "latin1");
  const table = Buffer.alloc(4 + syms.length * 4);
  table.writeUInt32BE(syms.length, 0);
  syms.forEach(([, i], k) => table.writeUInt32BE(1000 + i, 4 + k * 4));
  const body = Buffer.concat([table, names]);
  const header = Buffer.from("/".padEnd(16) + "0".padEnd(12) + "0".padEnd(6) + "0".padEnd(6) + "0".padEnd(8) + String(body.length).padEnd(10) + "`\n", "latin1");
  return Buffer.concat([Buffer.from("!<arch>\n", "latin1"), header, body]);
}

test("symbolIndex は同じ名前のメンバーがあっても、メンバーの定義する初期化子でモジュールを決める", () => {
  const ar = arWith([["l_a", "initialize_Init_Prelude", "runtime_initialize_Init_Prelude"], ["l_b", "initialize_Lean_Data_Json_Basic"], ["l_no_init"]]);
  const index = symbolIndex([ar], ["Init.Prelude", "Lean.Data.Json.Basic"]);
  assert.equal(index.get("l_a"), "Init.Prelude");
  assert.equal(index.get("l_b"), "Lean.Data.Json.Basic");
  assert.equal(index.get("l_no_init"), undefined);
  assert.throws(() => symbolIndex([Buffer.from("not an archive")], []), /ar の形式ではない/);
  assert.throws(() => symbolIndex([Buffer.concat([Buffer.from("!<arch>\n"), Buffer.from("__.SYMDEF".padEnd(60))])], []), /GNU 形式のシンボル表が無い/);
});

test("initSymbolOf は Lean の Name.mangle と同じ綴りにする", () => {
  assert.equal(initSymbolOf("Init.Data.List"), "initialize_Init_Data_List");
  assert.equal(initSymbolOf("A_B.C"), "initialize_A__B_C");
});

test("parseModule は // Module: の無い C を断る", () => {
  assert.throws(() => parseModule("int x;"), /Module/);
  assert.equal(parseModule(moduleA).name, "Pkg.A");
});
