#!/usr/bin/env node
// refs — 撤回・訂正の伝播: その ID を引いている場所を全部出す（documents / lean / 契約 / 設計 / README）
//   refs <ID>
import { spawnSync } from "node:child_process";
import { findProjectRoot } from "./lib.mjs";
const args = process.argv.slice(2);
const id = args[0];
if (!id) { console.error("usage: cradle refs <HS-001|MQ-003|UX-002|INFRA-D-004|イベント#5>"); process.exit(1); }
// git grep は cwd の下しか見ないので、サブディレクトリから呼んでもプロジェクトルートから探す（パスはルートからの相対）。
// 色（color.grep・color.ui の always）は区切りの「:」と ID の後ろにエスケープを挟み、grep.column は桁の欄を足すので、利用者の設定を -c で切る
const r = spawnSync("git", ["-c", "color.grep=false", "-c", "grep.column=false", "grep", "-n", "-I", "-F", "--", id], { stdio: ["ignore", "pipe", "pipe"], cwd: findProjectRoot(), encoding: "utf8" });
// git grep の 1 は一致なし（0 箇所）。git が無い・git の外などの失敗を 0 箇所と言うと、撤回の派生を洗い漏らす
if (r.error || (r.status ?? 2) > 1) { console.error(`cradle refs: git grep が失敗しました: ${r.error?.message ?? r.stderr.trim()}`); process.exit(1); }
// ID は文字どおりに探し（-F）、後ろに ID の続き（数字・英小文字・「.数字」）が来る一致は数えない: イベント#5 は #50・#5.1・#5a を拾わず、文末の「.」は拾う。
// 行は path:行番号:中身で、見るのは最初の「:数字:」より後ろの中身
const exact = new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![0-9a-z]|\\.[0-9])");
const lines = (r.stdout || "").split("\n").filter(Boolean).filter(l => exact.test(l.replace(/^.*?:\d+:/, "")));
console.log(`${id}: ${lines.length} 箇所`);
for (const l of lines) console.log("  " + l);
console.log("documents 側で撤回・訂正したら、ここに出た派生（Lean の出典・openapi・infra-design・README）を洗い直すこと。");
