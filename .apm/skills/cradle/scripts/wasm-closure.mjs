// wasm-closure — Lean が吐いた C を項目に切り、入口から届く項目だけを残す（mockup-build の中身。入出力を持たない）。
//
// なぜ要るか: 雛形のモデルは `import Lean`（属性の登録と JSON のため）を持つ。そのまま wasm に束ねると、初期化子の連鎖がコンパイラ全部を連れてくる。
// C の `initialize_*` は import の連鎖と「起動時に値を作る定数」だけで、閉じた項は遅延（once cell）なので、
// 届くシンボルだけを残し、初期化子も届く定数の分だけに削れば、実行に要る分だけになる。
//
// 生成 C の形（Lean の版で変わりうる）に頼っている。読めない形に出会ったら推測せず投げる — 黙って初期化を落とさない。

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;
const INIT_FN = /^LEAN_EXPORT lean_object\* ((?:runtime_|meta_)?initialize_[A-Za-z0-9_]+)\(uint8_t builtin\) ?\{/;
const CPP_GUARD = /#ifdef __cplusplus\n(?:extern "C" \{\n|\}\n)#endif\n/g;

/** C の文字列・文字のリテラルを空にする（中の語を参照と数えない）。 */
const stripLiterals = (text) => text.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');

/** 項目が参照する語（局所変数や型の名前も混じる。引いて当たらない語は捨てる）。 */
export function tokensOf(text) { return new Set(stripLiterals(text).match(IDENT) ?? []); }

/** ファイルの先頭から項目（前処理行・宣言・定義）に切る。深さ 0 の `;` か、`{` を閉じたあとに `;` が続かない所が切れ目。 */
export function splitItems(source) {
  const text = source.replace(CPP_GUARD, "");
  const items = [];
  let start = 0, depth = 0, i = 0;
  const push = (end) => { const t = text.slice(start, end).trim(); if (t) items.push(t); start = end; };
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
      i++; continue;
    }
    if (c === "/" && text[i + 1] === "/") { const n = text.indexOf("\n", i); i = n < 0 ? text.length : n + 1; if (depth === 0) start = i; continue; }
    if (c === "#" && depth === 0 && (i === 0 || text[i - 1] === "\n")) {
      const n = text.indexOf("\n", i); const end = n < 0 ? text.length : n + 1;
      items.push(text.slice(i, end).trim()); i = end; start = i; continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth < 0) throw new Error("C の波かっこが釣り合わない");
      if (depth === 0) {
        let j = i + 1; while (j < text.length && /\s/.test(text[j])) j++;
        if (text[j] !== ";" && text[j] !== ",") { i++; push(i); continue; }
      }
    } else if (c === ";" && depth === 0) { i++; push(i); continue; }
    i++;
  }
  if (depth !== 0) throw new Error("C の波かっこが釣り合わない（終端）");
  if (text.slice(start).trim()) throw new Error(`C の末尾を項目に切れない: ${text.slice(start, start + 80)}`);
  return items;
}

/** 項目の宣言する名前と種類。def = 実体を持つ / decl = 宣言だけ / static は翻訳単位に閉じる。 */
export function classify(item) {
  const eq = item.search(/[={]/);
  const head = eq < 0 ? item : item.slice(0, eq);
  const fn = head.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  const isFn = !!fn;
  const name = isFn ? fn[1] : head.match(/([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*;?\s*$/)?.[1];
  if (!name) throw new Error(`宣言の名前を読めない: ${item.slice(0, 120)}`);
  const hasBody = eq >= 0;
  const isStatic = /^static\b/.test(item);
  const isExtern = /^extern\b/.test(item);
  const def = hasBody || (!isFn && !isExtern);
  return { name, def, isStatic, isFn };
}

/** 初期化子の本体を文の組に切る: import の呼び出し（捨てる）と、定数 1 つの初期化（var）と、var の無い作用（捨てる）。 */
export function parseInitBody(item) {
  const lines = item.split("\n").map(l => l.trim()).filter(Boolean);
  const headLine = lines.shift();
  if (lines.pop() !== "}") throw new Error(`初期化子の形を読めない: ${headLine}`);
  const prologue = [], groups = [];
  let i = 0;
  const peek = () => lines[i];
  // 冒頭: lean_object * res; / 済みの印の検査と設定
  while (i < lines.length && (peek() === "lean_object * res;" || /^if \(_G_\w+\) return lean_io_result_mk_ok\(lean_box\(0\)\);$/.test(peek()) || /^_G_\w+ = true;$/.test(peek()))) prologue.push(lines[i++]);
  const ERROR = "if (lean_io_result_is_error(res)) return res;";
  while (i < lines.length) {
    const l = lines[i];
    if (l === "return lean_io_result_mk_ok(lean_box(0));") { i++; continue; }
    const pure = l.match(/^([A-Za-z_]\w*) = (_init_\w+)\(\);$/);
    if (pure) {
      const body = [l]; i++;
      if (lines[i] === `lean_mark_persistent(${pure[1]});`) body.push(lines[i++]);
      groups.push({ var: pure[1], lines: body });
      continue;
    }
    const call = l.match(/^res = ([A-Za-z_]\w*)\((builtin)?\);$/);
    if (call) {
      const body = [l]; i++;
      if (lines[i] !== ERROR) throw new Error(`初期化子の形を読めない（${call[1]} のあと）: ${headLine}: ${lines[i]}`);
      body.push(lines[i++]);
      let v = null;
      // スカラーの定数は箱から出して受ける（Lean の Expr.unboxOpName の名前だけ）
      const get = lines[i]?.match(/^([A-Za-z_]\w*) = (?:lean_io_result_get_value\(res\)|lean_unbox(?:_usize|_uint32|_uint64|_float32|_float)?\(lean_io_result_get_value\(res\)\));$/);
      if (get) {
        v = get[1]; body.push(lines[i++]);
        if (lines[i] === `lean_mark_persistent(${v});`) body.push(lines[i++]);
      }
      if (lines[i] !== "lean_dec_ref(res);") throw new Error(`初期化子の形を読めない（${call[1]} の結果）: ${headLine}: ${lines[i]}`);
      body.push(lines[i++]);
      if (/^(?:runtime_|meta_)?initialize_/.test(call[1])) continue;   // import の連鎖は捨てる（順序は initSchedule が決める）
      groups.push({ var: v, lines: body });
      continue;
    }
    // 中継だけの initialize_X は runtime_ / meta_ を呼び、最後に自分の結果を返す形もある
    if (/^return (?:runtime_|meta_)?initialize_\w+\(builtin\);$/.test(l)) { i++; continue; }
    throw new Error(`初期化子の文を読めない: ${headLine}: ${l}`);
  }
  return { head: headLine, prologue, groups };
}

/** C 1 本を読む。 */
export function parseModule(source) {
  const name = source.match(/^\/\/ Module: (\S+)$/m)?.[1];
  if (!name) throw new Error("C の冒頭に // Module: が無い（Lean の生成物ではない）");
  const items = [];
  const defs = new Map();       // 名前 → 実体の項目（プロトタイプとの区別は kind）
  const statics = new Set();
  const inits = new Map();      // 初期化子の名前 → parseInitBody
  const varInit = new Map();    // 定数名 → { fn, group }
  for (const text of splitItems(source)) {
    if (text.startsWith("#")) { items.push({ kind: "pp", text }); continue; }
    const m = text.match(INIT_FN);
    if (m) {
      const parsed = parseInitBody(text);
      inits.set(m[1], parsed);
      for (const g of parsed.groups) if (g.var) varInit.set(g.var, { fn: m[1], group: g });
      items.push({ kind: "init", name: m[1], text });
      continue;
    }
    const c = classify(text);
    const item = { kind: c.def ? "def" : "decl", name: c.name, text, isStatic: c.isStatic, isFn: c.isFn };
    items.push(item);
    if (c.isStatic) statics.add(c.name);
    if (c.def) { if (!defs.has(c.name)) defs.set(c.name, []); defs.get(c.name).push(item); }
  }
  return { name, items, defs, statics, inits, varInit };
}

/**
 * 入口から届くものを集める。loadModules(名前の配列) は C の本文の配列を返す（標準ライブラリはここで作る）。
 * locate(シンボル) はそのシンボルを定義するモジュール名（索引に無ければ undefined — ランタイムか局所名）。
 */
export async function reach({ roots, modules: initial, loadModules, locate }) {
  const modules = new Map();
  const owner = new Map();                  // static でない実体の名前 → モジュール
  const add = (parsed) => {
    if (modules.has(parsed.name)) return;
    modules.set(parsed.name, parsed);
    for (const [n] of parsed.defs) if (!parsed.statics.has(n)) owner.set(n, parsed.name);
    for (const [v] of parsed.varInit) if (!owner.has(v)) owner.set(v, parsed.name);
  };
  for (const s of initial) add(parseModule(s));
  const seen = new Set();                   // "モジュール\0名前"
  const kept = new Map();                   // モジュール → { items: Set, vars: Set }
  const keptOf = (m) => { if (!kept.has(m)) kept.set(m, { items: new Set(), vars: new Set() }); return kept.get(m); };
  let work = [];                            // [モジュール（文脈）, 語]
  let waiting = [];                         // 索引に当たったが未読のモジュールを待つ語
  const unresolved = new Set();             // 索引が定義元と言うのに本文に実体が無い（生成物と配布物の食い違い）
  const visitTokens = (mod, tokens) => { for (const t of tokens) work.push([mod, t]); };
  const visit = (mod, name) => {
    const key = `${mod.name}\0${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const k = keptOf(mod.name);
    for (const item of mod.defs.get(name) ?? []) { k.items.add(item); visitTokens(mod, tokensOf(item.text)); }
    const vi = mod.varInit.get(name);
    if (vi) { k.vars.add(name); visitTokens(mod, tokensOf(vi.group.lines.join("\n"))); }
  };
  for (const r of roots) work.push([null, r]);
  for (;;) {
    while (work.length) {
      const [ctx, t] = work.pop();
      if (ctx && ctx.statics.has(t)) { visit(ctx, t); continue; }
      const o = owner.get(t);
      if (o) { visit(modules.get(o), t); continue; }
      const n = locate(t);
      if (n && !modules.has(n)) { waiting.push([ctx, t, n]); continue; }
      if (n) unresolved.add(t);
    }
    if (!waiting.length) break;
    const names = [...new Set(waiting.map(w => w[2]))];
    const sources = await loadModules(names);
    for (const s of sources) add(parseModule(s));
    const again = waiting; waiting = [];
    for (const [ctx, t, n] of again) {
      if (!modules.has(n)) throw new Error(`${n} の C を読めたのにモジュール名が合わない（${t}）`);
      work.push([ctx, t]);
    }
  }
  return { modules, kept, unresolved: [...unresolved].sort(), keptOf };
}

/** 残すモジュールの C を組み直す。元の並びを保ち、残した実体が使う宣言だけを添え、初期化子は残す定数の分だけにする。 */
export function prunedSource(mod, keep) {
  const fns = new Map();     // 初期化子 → 残す組
  for (const [v, { fn, group }] of mod.varInit) {
    if (!keep.vars.has(v)) continue;
    if (!fns.has(fn)) fns.set(fn, []);
    fns.get(fn).push(group);
  }
  const initText = new Map();
  for (const [fn, groups] of fns) {
    const parsed = mod.inits.get(fn);
    const order = new Map(parsed.groups.map((g, i) => [g, i]));
    groups.sort((a, b) => order.get(a) - order.get(b));
    const body = groups.flatMap(g => g.lines);
    initText.set(fn, [parsed.head, ...parsed.prologue, ...body, "return lean_io_result_mk_ok(lean_box(0));", "}"].join("\n"));
  }
  const used = new Set();
  for (const item of keep.items) for (const t of tokensOf(item.text)) used.add(t);
  for (const t of initText.values()) for (const x of tokensOf(t)) used.add(x);
  const out = [];
  for (const item of mod.items) {
    if (item.kind === "pp") { out.push(item.text); continue; }
    if (item.kind === "init") { if (initText.has(item.name)) out.push(initText.get(item.name)); continue; }
    // 関数は届いたものだけ。データは語で引く（初期化子の済みの印 _G_* は届く範囲の探索を通らない）
    if (item.kind === "def") { if (keep.items.has(item) || (!item.isFn && used.has(item.name))) out.push(item.text); continue; }
    // 宣言: 残した実体が使う語だけ。定数の初期化子も同じ語で届く
    if (used.has(item.name)) out.push(item.text);
  }
  return `// Module: ${mod.name}\n${out.join("\n")}\n`;
}

/**
 * 残す初期化子を呼ぶ順を決める。定数を作る式が別の初期化子の定数に届くなら、そちらを先に。
 * 同じモジュールの中は runtime_ → meta_ → 無印（ネイティブの initialize_ と同じ順）。
 */
export function initSchedule({ modules, kept }) {
  const fnOfVar = new Map();
  const fns = new Map();    // 初期化子 → { mod, groups }
  for (const [name, k] of kept) {
    const mod = modules.get(name);
    for (const v of k.vars) {
      const { fn, group } = mod.varInit.get(v);
      fnOfVar.set(v, fn);
      if (!fns.has(fn)) fns.set(fn, { mod, groups: [] });
      fns.get(fn).groups.push(group);
    }
  }
  const owner = new Map();
  for (const [name] of kept) { const mod = modules.get(name); for (const [n] of mod.defs) if (!mod.statics.has(n)) owner.set(n, mod); }
  const reachVars = (mod, startTokens) => {
    const seen = new Set(); const out = new Set(); const stack = [...startTokens].map(t => [mod, t]);
    while (stack.length) {
      const [m, t] = stack.pop();
      const target = m.statics.has(t) ? m : owner.get(t);
      if (fnOfVar.has(t)) out.add(t);
      if (!target) continue;
      const key = `${target.name}\0${t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const item of target.defs.get(t) ?? []) for (const x of tokensOf(item.text)) stack.push([target, x]);
    }
    return out;
  };
  const deps = new Map();
  for (const [fn, { mod, groups }] of fns) {
    const d = new Set();
    for (const g of groups) for (const v of reachVars(mod, tokensOf(g.lines.join("\n")))) if (fnOfVar.get(v) !== fn) d.add(fnOfVar.get(v));
    deps.set(fn, d);
  }
  const rank = (f) => f.startsWith("runtime_") ? 0 : f.startsWith("meta_") ? 1 : 2;
  const names = [...fns.keys()].sort((a, b) => a.replace(/^(?:runtime_|meta_)/, "").localeCompare(b.replace(/^(?:runtime_|meta_)/, "")) || rank(a) - rank(b));
  const state = new Map(); const order = [];
  const go = (f, path) => {
    if (state.get(f) === 2) return;
    if (state.get(f) === 1) throw new Error(`初期化子の依存が輪になった: ${[...path, f].join(" → ")}`);
    state.set(f, 1);
    for (const d of [...deps.get(f)].sort()) go(d, [...path, f]);
    state.set(f, 2); order.push(f);
  };
  for (const f of names) go(f, []);
  return order;
}

/** 初期化子を順に呼ぶ C。 */
export function initSource(order) {
  return `#include <lean/lean.h>\n${order.map(f => `extern lean_object* ${f}(uint8_t);`).join("\n")}\nlean_object* cradle_init_modules(void) {\n  lean_object* res;\n${order.map(f => `  res = ${f}(1); if (lean_io_result_is_error(res)) return res; lean_dec_ref(res);`).join("\n")}\n  return lean_io_result_mk_ok(lean_box(0));\n}\n`;
}

/** GNU ar のシンボル表を読む: シンボル → メンバーの位置。 */
export function arSymbols(buf) {
  if (buf.toString("latin1", 0, 8) !== "!<arch>\n") throw new Error("ar の形式ではない");
  const name = buf.toString("latin1", 8, 24).trim();
  if (name !== "/") throw new Error(`GNU 形式のシンボル表が無い（先頭のメンバー: ${name}）`);
  const size = Number(buf.toString("latin1", 56, 66).trim());
  const base = 68;
  const count = buf.readUInt32BE(base);
  const out = new Map();
  let p = base + 4 + count * 4;
  const end = base + size;
  for (let i = 0; i < count; i++) {
    const z = buf.indexOf(0, p);
    if (z < 0 || z >= end) throw new Error("ar のシンボル表が途中で切れている");
    out.set(buf.toString("latin1", p, z), buf.readUInt32BE(base + 4 + i * 4));
    p = z + 1;
  }
  return out;
}

/** text に残っている手元のパスを返す（無ければ null）。区切りまで含めて比べる — ホームが /home/web でも Emscripten の /home/web_user に当たらない。 */
export function localPathIn(text, paths) {
  return paths.map(p => `${p.replace(/\/+$/, "")}/`).find(p => p !== "/" && text.includes(p)) ?? null;
}

/** モジュール名 → 初期化子の C 名（標準ライブラリの Name.mangle）。 */
export function initSymbolOf(moduleName) {
  return "initialize_" + moduleName.split(".").map(seg => seg.replace(/_/g, "__").replace(/[^A-Za-z0-9_]/g, c => `_u${c.codePointAt(0).toString(16).padStart(4, "0")}`)).join("_");
}

/** ar の索引群とモジュール名の一覧から シンボル → モジュール名 を作る。メンバーの名前は重複するので、メンバーが定義する初期化子で引く。 */
export function symbolIndex(archives, moduleNames) {
  const byInit = new Map(moduleNames.map(m => [initSymbolOf(m), m]));
  const index = new Map();
  for (const buf of archives) {
    const syms = arSymbols(buf);
    const memberModule = new Map();
    for (const [s, off] of syms) { const m = byInit.get(s); if (m) memberModule.set(off, m); }
    for (const [s, off] of syms) { const m = memberModule.get(off); if (m && !index.has(s)) index.set(s, m); }
  }
  return index;
}
