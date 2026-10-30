#!/usr/bin/env node
// contract-skeleton — 生成された抽象契約テストの具象サブクラスの骨格を標準出力に出す
//   contract-skeleton <生成された抽象契約テスト.kt> [--package <pkg>]
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "./lib.mjs";
const opts = parseArgs(process.argv.slice(2));
const file = opts._[0];
if (!file) { console.error("usage: cradle contract-skeleton backend/src/generated/kotlin-test/.../XxxContractTest.kt"); process.exit(1); }
if (!existsSync(file)) { console.error(`cradle contract-skeleton: ${file} が無い`); process.exit(1); }
// 在っても読めないパス（ディレクトリ・権限の無いファイル）もスタックトレースでなく 1 行で止める
let text;
try { text = readFileSync(file, "utf8"); } catch (e) { console.error(`cradle contract-skeleton: ${file} を読めません: ${e.message}`); process.exit(1); }
const pkg = (text.match(/^package\s+(\S+)/m) ?? [])[1] ?? "";
const cls = (text.match(/abstract\s+class\s+(\w+)/) ?? [])[1];
if (!cls) { console.error("abstract class が見つかりません"); process.exit(1); }
const sigs = [...text.matchAll(/^\s*(?:protected\s+)?abstract\s+fun\s+(\w+)\s*\(([^)]*)\)\s*:\s*([^\n={]+)/gm)];
// 値の無い --package（末尾か、次の語がフラグか、--package= のような空の値）は生成ファイル自身の package のまま。空のまま出すと `package ` の不正な Kotlin になる
const outPkg = typeof opts.package === "string" && opts.package.trim() ? opts.package : pkg;
const lines = [`package ${outPkg}`, "", `import ${pkg}.${cls}`, "", "/** 生成された契約テストに本番実装を配線する。Repository に fake を挟まない — 本番の実装を実 DB 相手にそのまま使う。Port は渡された生成モックを配線する。 */",
  `class ${cls}Impl : ${cls}() {`];
for (const m of sigs) lines.push(`\toverride fun ${m[1]}(${m[2].trim()}): ${m[3].trim()} = TODO("wire: 本番の実装を返す（${m[3].trim()}）")`);
lines.push("}", "");
console.log(lines.join("\n"));
process.exit(0);
