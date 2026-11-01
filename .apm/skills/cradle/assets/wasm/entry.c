/*
  ブラウザの wasm の入口（mockup-build が束ねる）。JS から呼ぶのはこの 2 つだけ。
  ドメインの判断は書かない — Protocol.lean の handle に文字列を渡して返すだけ。
*/
#include <emscripten.h>
#include <lean/lean.h>
#include <stdlib.h>
#include <string.h>

extern void lean_initialize_runtime_module(void);
extern void lean_io_mark_end_initialization(void);
extern lean_object* cradle_init_modules(void);              /* 生成物: 届く定数の初期化子を順に呼ぶ */
extern lean_object* cradle_handle(lean_object* input);      /* Protocol.lean の @[export cradle_handle] */

/* 0 = 成功。タスクの管理は起動しない（スレッドを持たず、Task は同期で走る） */
EMSCRIPTEN_KEEPALIVE int cradle_init(void) {
  lean_initialize_runtime_module();
  lean_set_panic_messages(true);
  lean_object* res = cradle_init_modules();
  lean_io_mark_end_initialization();
  if (lean_io_result_is_error(res)) { lean_dec_ref(res); return 1; }
  lean_dec_ref(res);
  return 0;
}

/* リクエスト（UTF-8、長さで渡す — NUL で切らず CLI の stdin と同じに読む）→ 応答（UTF-8、呼び手が free する。メモリが足りなければ NULL） */
EMSCRIPTEN_KEEPALIVE char* cradle_call(const char* request, size_t size) {
  lean_object* out = cradle_handle(lean_mk_string_from_bytes(request, size));
  size_t n = lean_string_size(out);   /* 終端の NUL を含む */
  char* copy = (char*)malloc(n);
  if (copy) memcpy(copy, lean_string_cstr(out), n);
  lean_dec_ref(out);
  return copy;
}
