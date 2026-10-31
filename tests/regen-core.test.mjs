// regen-impact の読み方（regen-core.mjs）の単体テスト。git も再生成も無しに、宣言の読み取り・変わった宣言・参照元を直に見る。
import test from "node:test";
import assert from "node:assert/strict";
import { declsOf, diffDecls, impactOf } from "../.apm/skills/cradle/scripts/regen-core.mjs";

test("declsOf は型・トップレベル・メンバーの順に読み、メンバーは直前の型を所有者にする。空行とコメントの行は読まない", () => {
  const text = [
    "// GENERATED — class Ignored",
    "/** class AlsoIgnored */",
    " * fun inDoc()",
    "",
    "val top: Int = 1",
    "  fun beforeOwner()",
    "data class Note(val id: NoteId)",
    "interface NoteRepository {",
    "\tfun find(id: NoteId): Note?",
    "\toverride suspend fun save(note: Note)",
    "\tval count: Int",
    "}",
    "internal fun `helper`(x: Int) = x",
    "typealias Id = Long",
  ].join("\n");
  assert.deepEqual([...declsOf(text)], [
    ["top:top", { name: "top", owner: null, kind: "val", sig: "val top: Int = 1" }],
    ["type:Note", { name: "Note", owner: null, kind: "class", sig: "data class Note(val id: NoteId)" }],
    ["type:NoteRepository", { name: "NoteRepository", owner: null, kind: "interface", sig: "interface NoteRepository {" }],
    ["member:NoteRepository.find:fun find(id: NoteId): Note?", { name: "find", owner: "NoteRepository", kind: "fun", sig: "fun find(id: NoteId): Note?" }],
    ["member:NoteRepository.save:override suspend fun save(note: Note)", { name: "save", owner: "NoteRepository", kind: "fun", sig: "override suspend fun save(note: Note)" }],
    ["member:NoteRepository.count:val count: Int", { name: "count", owner: "NoteRepository", kind: "val", sig: "val count: Int" }],
    ["top:helper", { name: "helper", owner: null, kind: "fun", sig: "internal fun `helper`(x: Int) = x" }],
    ["type:Id", { name: "Id", owner: null, kind: "typealias", sig: "typealias Id = Long" }],
  ]);
  // 行末の空白は署名に入らない。字下げの無い fun は所有者があってもトップレベル
  assert.deepEqual([...declsOf("class A {  \nfun b()\n}\n").keys()], ["type:A", "top:b"]);
});

test("diffDecls は署名行が片方にしか無い宣言を返し、後にも同じ所有者・名前があれば changed、無ければ removed、前に無かった名前は added", () => {
  const before = "interface R {\n\tfun find(id: Id): N?\n\tfun save(n: N)\n\tfun keep()\n}\n";
  const after = "interface R {\n\tfun find(id: Id): N\n\tfun keep()\n\tfun delete(id: Id)\n}\n";
  assert.deepEqual(diffDecls(before, after).map(d => [d.owner, d.name, d.kind, d.change]), [
    ["R", "find", "fun", "changed"], ["R", "save", "fun", "removed"], ["R", "delete", "fun", "added"],
  ]);
  // 前に無いファイル（HEAD に無い）は全部 added、後に無いファイルは全部 removed。変わらなければ空
  assert.deepEqual(diffDecls("", "class P\n").map(d => [d.name, d.change]), [["P", "added"]]);
  assert.deepEqual(diffDecls("class P\n", "").map(d => [d.name, d.change]), [["P", "removed"]]);
  assert.deepEqual(diffDecls(before, before), []);
});

test("impactOf は型をその名前で、メンバーを所有者の名前と「.名前」「fun / val / var 名前」の両方で探し、参照元の多い順、同数なら名前順に並べる", () => {
  const hand = [
    { file: "a.kt", text: "class X(private val r: R) {\n\tfun show() = r.find(1)\n}\n" },
    { file: "b.kt", text: "class Impl : R {\n\toverride fun find(id: Id) = null\n}\n" },
    { file: "c.kt", text: "fun find() = 1\nval n: Note = Note()\n" },
    { file: "d.kt", text: "class Notebook\n" },
  ];
  const symbols = [
    { name: "Zeta", owner: null, change: "added", files: new Set(["z.kt"]) },
    { name: "find", owner: "R", change: "changed", files: new Set(["r.kt", "r2.kt"]) },
    { name: "Note", owner: null, change: "removed", files: new Set(["n.kt"]) },
    { name: "Alpha", owner: null, change: "added", files: new Set(["a0.kt"]) },
  ];
  assert.deepEqual(impactOf(symbols, hand), [
    { symbol: "R.find", kinds: ["changed"], generatedFiles: ["r.kt", "r2.kt"], referencedBy: ["a.kt", "b.kt"] },
    { symbol: "Note", kinds: ["removed"], generatedFiles: ["n.kt"], referencedBy: ["c.kt"] },
    { symbol: "Alpha", kinds: ["added"], generatedFiles: ["a0.kt"], referencedBy: [] },
    { symbol: "Zeta", kinds: ["added"], generatedFiles: ["z.kt"], referencedBy: [] },
  ]);
  assert.deepEqual(impactOf([], hand), []);
});
