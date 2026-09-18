import test from "node:test";
import assert from "node:assert/strict";
import { joinWrapped, parseDecl, splitTypeApp, substituteTypeParams, kindOf, hintOf, payloadHeads, schemasFrom } from "../.apm/skills/cradle/scripts/schema.mjs";

// #print の出力の写し（lake env lean が返す形。構成子の型は → で折り返される）
const commandPrint = (root, ctors) => [`inductive ${root}.Runtime.Command : Type`, "number of parameters: 0", "constructors:", ...ctors];
const structPrint = (name, params, fields) => [
  `structure ${name}${params.length ? ` (${params.join(" ")} : Type)` : ""} : Type`, `number of parameters: ${params.length}`, "fields:",
  ...fields.map(([f, t]) => `  ${name}.${f} : ${t}`), "constructor:", `  ${name}.mk : ${name}`];
const ctorsOf = (root, lines) => parseDecl(joinWrapped(commandPrint(root, lines))).constructors;

test("値オブジェクトと同名の型引数は Runtime の実引数に解決され、手書き FromJson の注記が付く", () => {
  const root = "RocketChat";
  const ctors = ctorsOf(root, ["RocketChat.Runtime.Command.createRoom : RocketChat.Application.CreateRoomUseCase.Command RocketChat.JoinCode →", "  RocketChat.Runtime.Command"]);
  assert.deepEqual(payloadHeads(ctors), ["RocketChat.Application.CreateRoomUseCase.Command"]);
  const printed = { "RocketChat.Application.CreateRoomUseCase.Command": structPrint("RocketChat.Application.CreateRoomUseCase.Command", ["JoinCode"], [["kind", "RocketChat.Application.CreateRoomUseCase.Kind"], ["joinCode", "Option JoinCode"]]) };
  const hints = { "RocketChat.JoinCode": "参加コードの文字列をそのまま受ける" };
  const printMore = (names) => Object.fromEntries(names.map(n => [n, ["inductive RocketChat.Application.CreateRoomUseCase.Kind : Type", "number of parameters: 0", "constructors:", "RocketChat.Application.CreateRoomUseCase.Kind.public : RocketChat.Application.CreateRoomUseCase.Kind", "RocketChat.Application.CreateRoomUseCase.Kind.private : RocketChat.Application.CreateRoomUseCase.Kind"]]));
  const s = schemasFrom(ctors, printed, hints, root, printMore);
  assert.deepEqual(s.createRoom.fields.find(f => f.name === "joinCode"), { name: "joinCode", type: "RocketChat.JoinCode", optional: true, kind: "text", wire: "string", hint: "参加コードの文字列をそのまま受ける" });
  assert.deepEqual(s.createRoom.fields.find(f => f.name === "kind"), { name: "kind", type: "RocketChat.Application.CreateRoomUseCase.Kind", optional: false, kind: "enum", options: ["public", "private"] });
});

test("ID の型引数は Runtime の具体名（Id で終わる）に解決されて id になる", () => {
  const root = "Sprout";
  const ctors = ctorsOf(root, ["Sprout.Runtime.Command.postNote : Sprout.Application.PostNoteUseCase.Command → Sprout.Runtime.Command", "Sprout.Runtime.Command.closeNote : Sprout.Application.CloseNoteUseCase.Command Sprout.Runtime.NoteId →", "  Sprout.Runtime.Command"]);
  const printed = {
    "Sprout.Application.PostNoteUseCase.Command": structPrint("Sprout.Application.PostNoteUseCase.Command", [], [["title", "Sprout.Title"]]),
    "Sprout.Application.CloseNoteUseCase.Command": structPrint("Sprout.Application.CloseNoteUseCase.Command", ["NoteId"], [["note", "NoteId"]]),
  };
  const hints = { "Sprout.Title": "題の文字列をそのまま受ける" };
  const s = schemasFrom(ctors, printed, hints, root, () => ({}));
  assert.deepEqual(s.closeNote, { type: "Sprout.Application.CloseNoteUseCase.Command", fields: [{ name: "note", type: "Sprout.Runtime.NoteId", optional: false, kind: "id" }] });
  assert.deepEqual(s.postNote.fields, [{ name: "title", type: "Sprout.Title", optional: false, kind: "text", wire: "string", hint: "題の文字列をそのまま受ける" }]);
});

test("名前空間の中で短く書いた手書き FromJson の注記も <Root>. 以下の末尾一致で引ける", () => {
  const hints = { JoinCode: "参加コード" };
  assert.equal(hintOf("RocketChat.JoinCode", hints, "RocketChat"), "参加コード");
  assert.equal(hintOf("RocketChat.Domain.JoinCode", hints, "RocketChat"), "参加コード");
  assert.equal(hintOf("Other.JoinCode", hints, "RocketChat"), undefined);
  assert.equal(kindOf("Option RocketChat.JoinCode", hints, "RocketChat").kind, "text");
  // binder 名のままの型は推測しない（呼び出し側が実引数に置き換える）
  assert.equal(kindOf("JoinCode", {}, "RocketChat").kind, "json");
  assert.equal(kindOf("Sprout.Runtime.NoteId", {}, "Sprout").kind, "id");
});

test("型の適用は括弧を考慮して分かち、binder 名は識別子の一部を壊さず実引数に置き換わる", () => {
  assert.deepEqual(splitTypeApp("Command (List Foo) Bar"), { head: "Command", args: ["List Foo", "Bar"] });
  assert.deepEqual(splitTypeApp("(Sprout.Foo (Option A) B)"), { head: "Sprout.Foo", args: ["Option A", "B"] });
  assert.deepEqual(splitTypeApp("Sprout.Title"), { head: "Sprout.Title", args: [] });
  assert.equal(substituteTypeParams("Option NoteId", { NoteId: "Sprout.Runtime.NoteId" }), "Option Sprout.Runtime.NoteId");
  assert.equal(substituteTypeParams("List A", { A: "List Foo" }), "List (List Foo)");
  assert.equal(substituteTypeParams("Other.NoteId NoteId NoteIdX", { NoteId: "X" }), "Other.NoteId X NoteIdX");
});

test("型引数の数が Runtime の適用と合わない構造体は fields を null にして理由を残す", () => {
  const ctors = ctorsOf("T", ["T.Runtime.Command.go : T.Application.GoUseCase.Command T.Runtime.AId → T.Runtime.Command"]);
  const printed = { "T.Application.GoUseCase.Command": structPrint("T.Application.GoUseCase.Command", ["AId", "BId"], [["a", "AId"]]) };
  const s = schemasFrom(ctors, printed, {}, "T", () => ({}));
  assert.equal(s.go.fields, null);
  assert.match(s.go.error, /型引数の数が合わない/);
});

test("1 段展開する値オブジェクトも自分の型引数を実引数で置き換える", () => {
  const root = "T";
  const ctors = ctorsOf(root, ["T.Runtime.Command.book : T.Application.BookUseCase.Command T.Runtime.RoomId → T.Runtime.Command"]);
  const printed = { "T.Application.BookUseCase.Command": structPrint("T.Application.BookUseCase.Command", ["RoomId"], [["slot", "T.Slot RoomId"], ["payload", "Unit"]]) };
  const printMore = (names) => { assert.deepEqual(names, ["T.Slot"]); return { "T.Slot": structPrint("T.Slot", ["RoomId"], [["room", "RoomId"], ["at", "T.Date"], ["tag", "T.Tag"]]) }; };
  const s = schemasFrom(ctors, printed, {}, root, printMore);
  const slot = s.book.fields.find(f => f.name === "slot");
  assert.equal(slot.kind, "object");
  assert.equal(slot.ref, undefined);
  assert.deepEqual(slot.fields, [
    { name: "room", type: "T.Runtime.RoomId", optional: false, kind: "id" },
    { name: "at", type: "T.Date", optional: false, kind: "date" },
    { name: "tag", type: "T.Tag", optional: false, kind: "json" },
  ]);
  assert.deepEqual(s.book.fields.find(f => f.name === "payload"), { name: "payload", type: "Unit", optional: false, kind: "json" });
});

test("substituteTypeParams は置き換えた実引数の語を別の binder として二重に置き換えない", () => {
  assert.equal(substituteTypeParams("Pair A B", { A: "B", B: "Sprout.Runtime.NoteId" }), "Pair B Sprout.Runtime.NoteId");
});
