// schema — `#print` の出力からコマンドごとの入力の形（spec-query の schemas）を組む純粋な部分。
// Lean を呼ぶのは spec-query.mjs で、ここは文字列の読み取りと種類の判定だけ（依存は Node 標準ライブラリだけ）。
//
// 型引数の扱い: Command 構造体の型引数（`Command (NoteId : Type)`）は、`<Root>.Runtime.Command` の構成子が
// 実際に適用している型（`Command Sprout.Runtime.NoteId`）で置き換えてから種類を決める。
// binder 名から推測しない — ID の型引数は Runtime の具体名に解決されて `Id` で終わり、
// 値オブジェクトを型引数にした Command でも手書き FromJson の注記（hint）が完全名で引ける。

/** `#print` の出力で、折り返された行を前の行につなぐ。フィールドの続きは 4 個以上の空白、
    構成子の型の続き（`→` で行が切れる）は字下げの深さに依らず前の行につなぐ。 */
export function joinWrapped(lines) {
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1] ?? "";
    const continues = /^\s{4,}\S/.test(l) || (/^\s+\S/.test(l) && /→\s*$/.test(prev));
    if (continues && out.length) out[out.length - 1] = prev + " " + l.trim();
    else out.push(l);
  }
  return out;
}

/** structure / inductive の #print ブロックを {kind, params, fields | options | constructors} にする。params は Type の binder 名の列。 */
export function parseDecl(lines) {
  if (!lines.length) return null;
  const head = lines[0];
  const params = [...head.matchAll(/\(([^()]*?)\s*:\s*Type[^)]*\)/g)].flatMap(m => m[1].trim().split(/\s+/));
  if (/^(?:@\[[^\]]*\]\s*)?structure\s/.test(head)) {
    const i = lines.findIndex(l => l.startsWith("fields:"));
    const fields = [];
    for (const l of lines.slice(i + 1)) {
      if (!l.startsWith("  ")) break;
      const m = l.match(/^\s+(\S+)\s*:\s*(.*)$/);
      if (m) fields.push({ name: m[1].split(".").pop(), type: m[2].trim() });
    }
    return { kind: "structure", params, fields };
  }
  if (/^(?:@\[[^\]]*\]\s*)?inductive\s/.test(head)) {
    const name = head.match(/inductive\s+(\S+)/)[1];
    const i = lines.findIndex(l => l.startsWith("constructors:"));
    const ctors = lines.slice(i + 1).map(l => l.match(/^(\S+)\s*:\s*(.*)$/)).filter(m => m && m[1].startsWith(name + ".")).map(m => ({ name: m[1].slice(name.length + 1), type: m[2].trim() }));
    // 引数の無い構成子だけの inductive は列挙（deriving ToJson は構成子名の文字列になる）
    if (ctors.length && ctors.every(c => c.type === name)) return { kind: "enum", params, options: ctors.map(c => c.name) };
    return { kind: "inductive", params, constructors: ctors };
  }
  return { kind: "other" };
}

/** 全体を括る括弧を外す（`(List Foo)` → `List Foo`。`(a) (b)` のような並びはそのまま）。 */
function stripOuterParens(text) {
  let s = text.trim();
  while (s.startsWith("(") && s.endsWith(")")) {
    let depth = 0, closesAtEnd = true;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") { depth--; if (depth === 0 && i < s.length - 1) { closesAtEnd = false; break; } }
    }
    if (!closesAtEnd) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

/** 型の適用 `C a (b c) d` を先頭語と実引数に分ける。括弧の中は空白があっても 1 引数で、外側の括弧は外す。 */
export function splitTypeApp(text) {
  const tokens = [];
  let depth = 0, cur = "";
  for (const ch of stripOuterParens(text)) {
    if (ch === "(") { depth++; cur += ch; }
    else if (ch === ")") { depth--; cur += ch; }
    else if (/\s/.test(ch) && depth === 0) { if (cur) { tokens.push(cur); cur = ""; } }
    else cur += ch;
  }
  if (cur) tokens.push(cur);
  return { head: tokens[0] ?? "", args: tokens.slice(1).map(stripOuterParens) };
}

/** 型の中の binder 名を実引数で置き換える（識別子の一部・名前空間付きの別名は触らない）。空白を含む実引数は括弧で包む。
    1 回の走査で全部置き換える — 置き換えた実引数の中の語を別の binder 名としてもう一度置き換えない。 */
export function substituteTypeParams(text, mapping) {
  const names = Object.keys(mapping);
  if (!names.length) return text;
  const alt = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.replace(new RegExp(`(?<![\\w.'?!])(${alt})(?![\\w.'?!])`, "g"), (_, name) => {
    const actual = mapping[name];
    return /\s/.test(actual) ? `(${actual})` : actual;
  });
}

/** 型引数の binder 名 → 実引数の対応。個数が合わなければ null（Runtime の適用と構造体の宣言が食い違っている）。 */
function paramMapping(params, args) {
  if (params.length !== args.length) return null;
  return Object.fromEntries(params.map((p, i) => [p, args[i]]));
}

/** 型名に合う手書き FromJson の注記。完全一致か `<Root>.` 以下の末尾一致で、複数が合えば長い名前（より限定した書き方）を取る。 */
export function hintOf(type, hints, root) {
  const under = type.startsWith(root + ".") ? type.slice(root.length + 1) : null;
  const fits = Object.keys(hints).filter(n => type === n || under === n || under?.endsWith("." + n));
  return fits.length ? hints[fits.sort((a, b) => b.length - a.length)[0]] : undefined;
}

/** 入力欄の種類を型名から決める（表示の都合。可否はモデルが決める）。id は {"id": n}、列挙は構成子名、値オブジェクトはフィールド名のオブジェクトで wire に乗る。
    手書きの FromJson を持つ型は人が打つ表記の文字列 1 本（hint に注記）。型引数は呼び出し側が Runtime の実引数に置き換えてから渡す（binder 名のままの型はここでは判定できない）。 */
export function kindOf(type, hints, root) {
  let s = stripOuterParens(type), optional = false;
  if (/^Option\s+/.test(s)) { optional = true; s = stripOuterParens(s.replace(/^Option\s+/, "")); }
  const base = { type: s, optional };
  if (/^(List|Array)\b/.test(s)) return { ...base, kind: "json" };
  if (s === "Bool") return { ...base, kind: "bool" };
  if (/^(Nat|Int|Float|UInt\d+|USize)$/.test(s)) return { ...base, kind: "number" };
  if (s === "String") return { ...base, kind: "text" };
  if (/(^|\.)(Date|PlainDate)$/.test(s)) return { ...base, kind: "date" };
  const { head, args } = splitTypeApp(s);
  const hint = hintOf(head, hints, root);
  if (hint !== undefined) return { ...base, kind: "text", wire: "string", hint };
  if (/Id$/.test(head.split(".").pop())) return { ...base, kind: "id" };
  if (head.startsWith(root + ".")) return { ...base, kind: "object", ref: head, refArgs: args };
  return { ...base, kind: "json" };
}

/** 構成子の型 `Payload → Command` を括弧の外の `→` で割った引数の型の列（引数の無い構成子は空）。 */
function argTypesOf(ctor) {
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of ctor.type) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "→" && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  return parts;
}

/** 構成子のペイロードの型（引数の無い構成子は null）。 */
function payloadOf(ctor) {
  return argTypesOf(ctor)[0] ?? null;
}

/** 構成子のペイロード型の先頭語（引数の無い構成子は null）— 契約検査が OpenAPI の x-cradle-model と突き合わせる完全名。 */
export function payloadTypeOf(ctor) {
  const p = payloadOf(ctor);
  return p ? splitTypeApp(p).head : null;
}

/** 構成子の列から、#print すべきペイロード構造体の名前（重複なし）。 */
export function payloadHeads(ctors) {
  return [...new Set(ctors.map(c => payloadOf(c)).filter(Boolean).map(p => splitTypeApp(p).head))];
}

/** 構造体の宣言のフィールドを、実引数で型引数を置き換えてから種類に写す。 */
function fieldsOf(decl, args, hints, root) {
  const mapping = paramMapping(decl.params, args);
  if (!mapping) return null;
  return decl.fields.map(f => ({ name: f.name, ...kindOf(substituteTypeParams(f.type, mapping), hints, root) }));
}

/** コマンドごとの入力の形: 構成子 → ペイロード構造体のフィールド（値オブジェクトは 1 段だけ展開、列挙は選択肢）。
    printed は payloadHeads の宣言（名前 → #print の行）、printMore は 1 段展開する型の宣言を同じ形で返す。 */
export function schemasFrom(ctors, printed, hints, root, printMore) {
  const specs = {};
  for (const c of ctors) specs[c.name] = { arg: payloadOf(c), arity: argTypesOf(c).length };
  const refs = new Set();
  for (const s of Object.values(specs)) {
    const arity = s.arity;
    delete s.arity;
    if (!s.arg) { s.fields = []; delete s.arg; continue; }
    // Runtime の構成子は `Payload → Command` の 1 引数 — 2 つ目以降の引数は入力欄に写せない
    if (arity > 1) { s.type = splitTypeApp(s.arg).head; s.fields = null; s.error = `構成子の引数が ${arity} 個ある（Runtime の構成子は Payload → Command の 1 引数）`; delete s.arg; continue; }
    const { head, args } = splitTypeApp(s.arg);
    const d = parseDecl(printed[head] ?? []);
    s.type = head;
    delete s.arg;
    if (!d || d.kind !== "structure") { s.fields = null; continue; }
    s.fields = fieldsOf(d, args, hints, root);
    if (s.fields === null) { s.error = `型引数の数が合わない: ${head} の宣言は ${d.params.length} 個、Runtime の適用は ${args.length} 個`; continue; }
    for (const f of s.fields) if (f.kind === "object") refs.add(f.ref);
  }
  const printed2 = printMore([...refs]);
  for (const s of Object.values(specs)) for (const f of s.fields ?? []) {
    if (f.kind !== "object") continue;
    const d = parseDecl(printed2[f.ref] ?? []);
    if (d?.kind === "enum") { f.kind = "enum"; f.options = d.options; }
    else if (d?.kind === "structure") {
      // 展開は 1 段だけ — 入れ子の中の値オブジェクトは JSON のまま
      const inner = fieldsOf(d, f.refArgs, hints, root);
      if (inner === null) f.kind = "json";
      else f.fields = inner.map(g => g.kind === "object" ? { name: g.name, type: g.type, optional: g.optional, kind: "json" } : g);
    } else f.kind = "json";
    delete f.ref;
    delete f.refArgs;
  }
  return specs;
}
