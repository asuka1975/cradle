#!/usr/bin/env node
// status — プロダクトオーナー向けの現在地。パイプラインの各フェーズがどこまで来ているかを事実だけで示す。
//   status [--json]
// 事実の集め方と文章の組み立ては status-core.mjs。ここは引数と設定を読み、出すだけ。
import { loadConfigOrFail, parseArgs } from "./lib.mjs";
import { collectStatus, renderStatus } from "./status-core.mjs";

const opts = parseArgs(process.argv.slice(2), { json: "bool" });
const cfg = loadConfigOrFail();
const s = collectStatus(cfg);
console.log(opts.json ? JSON.stringify(s, null, 2) : renderStatus(s, cfg).join("\n"));
