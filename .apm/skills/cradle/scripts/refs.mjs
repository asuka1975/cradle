#!/usr/bin/env node
// refs — 撤回・訂正の伝播: その ID を引いている場所を全部出す（documents / lean / 契約 / 設計 / README）
//   refs <ID>
import { spawnSync } from "node:child_process";
import { findProjectRoot } from "./lib.mjs";
const args = process.argv.slice(2);
const id = args[0];
if (!id) { console.error("usage: cradle refs <HS-001|MQ-003|UX-002|INFRA-D-004|イベント#5>"); process.exit(1); }
// git grep は cwd の下しか見ないので、サブディレクトリから呼んでもプロジェクトルートから探す（パスはルートからの相対）
const r = spawnSync("git", ["grep", "-n", "-I", "--", id], { stdio: ["ignore", "pipe", "pipe"], cwd: findProjectRoot(), encoding: "utf8" });
const lines = (r.stdout || "").split("\n").filter(Boolean);
console.log(`${id}: ${lines.length} 箇所`);
for (const l of lines) console.log("  " + l);
console.log("documents 側で撤回・訂正したら、ここに出た派生（Lean の出典・openapi・infra-design・README）を洗い直すこと。");
process.exit(0);
