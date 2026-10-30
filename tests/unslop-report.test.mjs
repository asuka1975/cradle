// unslop の error の要約（Stop hook と hook-client の checkAll が同じ組み立てで使う）の文面。
import { test } from "node:test";
import assert from "node:assert/strict";
import { unslopErrorSummary } from "../.apm/skills/cradle/scripts/unslop-report.mjs";

const finding = (i, severity = "error") => ({ rule: "comment-status", severity, file: "e2e/flow.ts", line: i, message: `m${i}` });
const errors = (n) => Array.from({ length: n }, (_, i) => finding(i + 1));
const line = (i) => `- e2e/flow.ts:${i} [comment-status] m${i}`;
const lines = (n) => Array.from({ length: n }, (_, i) => line(i + 1)).join("\n");

const stop = { lead: (n) => `作業ツリーの差分に unslop 違反（error）が ${n} 件あります。止まる前に直すこと（規約は unslop と comments）:`, full: "cradle unslop --diff" };
const all = { lead: (n) => `unslop --all の検査対象にerrorが ${n} 件あります。終了前に修正してください。`, full: "cradle unslop --all" };

test("error だけを数えて先頭 15 件を並べ、warn は件数にも一覧にも入れない", () => {
  assert.equal(unslopErrorSummary([finding(1, "warn"), finding(2), finding(3, "info")], stop),
    `作業ツリーの差分に unslop 違反（error）が 1 件あります。止まる前に直すこと（規約は unslop と comments）:\n${line(2)}`);
  assert.equal(unslopErrorSummary(errors(15), all),
    `unslop --all の検査対象にerrorが 15 件あります。終了前に修正してください。\n${lines(15)}`);
});

test("16 件目からは全件の出し方を一行で添える", () => {
  assert.equal(unslopErrorSummary(errors(16), stop),
    `作業ツリーの差分に unslop 違反（error）が 16 件あります。止まる前に直すこと（規約は unslop と comments）:\n${lines(15)}\n…（cradle unslop --diff で全件）`);
  assert.equal(unslopErrorSummary(errors(20), all),
    `unslop --all の検査対象にerrorが 20 件あります。終了前に修正してください。\n${lines(15)}\n…（cradle unslop --all で全件）`);
});

test("error が無ければ null", () => {
  assert.equal(unslopErrorSummary([], stop), null);
  assert.equal(unslopErrorSummary([finding(1, "warn")], all), null);
});
