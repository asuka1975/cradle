#!/usr/bin/env node
// contract-skeleton — 生成された抽象契約テストの具象サブクラスの骨格を標準出力に出す
//   contract-skeleton <生成された抽象契約テスト.kt> [--package <pkg>]
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const file = args[0];
if (!file) { console.error("usage: cradle contract-skeleton backend/src/generated/kotlin-test/.../XxxContractTest.kt"); process.exit(1); }
const text = readFileSync(file, "utf8");
const pkg = (text.match(/^package\s+(\S+)/m) ?? [])[1] ?? "";
const cls = (text.match(/abstract\s+class\s+(\w+)/) ?? [])[1];
if (!cls) { console.error("abstract class が見つかりません"); process.exit(1); }
const sigs = [...text.matchAll(/^\s*(?:protected\s+)?abstract\s+fun\s+(\w+)\s*\(([^)]*)\)\s*:\s*([^\n={]+)/gm)];
const outPkg = (args.indexOf("--package") >= 0 ? args[args.indexOf("--package") + 1] : pkg);
const lines = [`package ${outPkg}`, "", `import ${pkg}.${cls}`, "", "/** 生成された契約テストに本番実装を配線する。Repository に fake を挟まない — 本番の実装を実 DB 相手にそのまま使う。Port は渡された生成モックを配線する。 */",
  `class ${cls}Impl : ${cls}() {`];
for (const m of sigs) lines.push(`\toverride fun ${m[1]}(${m[2].trim()}): ${m[3].trim()} = TODO("wire: 本番の実装を返す（${m[3].trim()}）")`);
lines.push("}", "");
console.log(lines.join("\n"));
process.exit(0);
