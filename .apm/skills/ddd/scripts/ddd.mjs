#!/usr/bin/env node
// ddd — 探索セッションの中継を機械にする。
//   ddd.mjs start                     5 ファイルの存在確認 + .session 印（hook が documents/ddd の編集を許す）
//   ddd.mjs questions @file|-         explorer の [QUESTIONS] JSON → documents/ddd/questions.md（改変せず写す）
//   ddd.mjs answers                   questions.md の回答欄 → 「質問 → 回答」（explorer に返す文面）
//   ddd.mjs end                       questions.md と .session を消し、ddd-clean-check --build を走らせる
//   ddd.mjs status                    出来事数・open の HS/UX/MQ・用語数
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, parseArgs, jsonArg, fail } from "../../cradle/scripts/lib.mjs";

const opts = parseArgs(process.argv.slice(2));
const [cmd, arg] = opts._;
const cfg = loadConfig();
const ddd = join(cfg.root, cfg.documents.ddd);
const FILES = ["event-timeline.md", "hotspots.md", "ubiquitous-language.md", "ux-review.md", "model-review.md"];
const qfile = join(ddd, "questions.md");
const marker = join(ddd, ".session");

function countRows(text, idRe, statusRe) {
  return (text.match(new RegExp(`^\\|\\s*${idRe}\\s*\\|.*\\|\\s*${statusRe}\\s*\\|`, "gm")) ?? []).length;
}

switch (cmd) {
  case "start": {
    const missing = FILES.filter(f => !existsSync(join(ddd, f)));
    if (missing.length) fail(`${cfg.documents.ddd}/ に無いファイル: ${missing.join(", ")}（cradle-init スキルで骨格を作る）`);
    writeFileSync(marker, JSON.stringify({ theme: opts.theme ?? null }) + "\n");
    console.log(`セッション開始（${cfg.documents.ddd}/.session）。終わりに ddd.mjs end を必ず実行する。`);
    break;
  }
  case "questions": {
    const j = jsonArg(arg ?? "-");
    if (!j || !Array.isArray(j.questions) || !j.questions.length) fail("JSON は {questions:[{question, header, multiSelect, options:[{label, description}]}]} の形");
    const lines = ["# 探索セッションの問い", "", "> これは一時ファイルです。ddd スキルが作り、回答が済んだら削除します。コミットしないでください。", ""];
    if (j.theme) lines.push(`テーマ: ${j.theme}`, "");
    if (j.preface) lines.push(j.preface, "");
    lines.push("## 確かめ方", "", "選択肢ごとに「選ぶとどうなるか」をモデルで動かせます。", "", "```bash",
      `cd ${cfg.lean.dir} && lake build && node mockup/server.mjs   # → http://localhost:${cfg.ports.mockup}`, "```", "",
      "画面の「シナリオ」から、下の表の「モックアップ」欄の名前を選んでください。表示されるのはモデルを実際に動かした結果です。", "");
    j.questions.forEach((q, i) => {
      const n = i + 1;
      lines.push(`## Q${n}. ${q.question}${q.multiSelect ? "（複数選択可）" : ""}`, "", "| | 選択肢 | 選ぶとどうなるか | モックアップ |", "|---|---|---|---|");
      (q.options ?? []).forEach((o, k) => {
        const letter = String.fromCharCode(97 + k);
        lines.push(`| **${letter}** | ${o.label} | ${o.description ?? ""} | \`probe-q${n}-${letter}\` |`);
      });
      lines.push("", "**回答:**", "", "<!-- 選択肢の記号か、自由に書いてください。「前提が違う」「問いが成り立たない」もそのまま。 -->", "");
    });
    writeFileSync(qfile, lines.join("\n"));
    console.log(`${cfg.documents.ddd}/questions.md に ${j.questions.length} 問を書いた。プローブ名は仮置き（用意できない選択肢は — と理由に書き換える）。`);
    break;
  }
  case "answers": {
    if (!existsSync(qfile)) fail("questions.md がありません");
    const text = readFileSync(qfile, "utf8");
    const blocks = text.split(/^## (?=Q\d+\.)/m).slice(1);
    const out = [];
    for (const b of blocks) {
      const title = b.split("\n")[0].trim();
      const m = b.match(/\*\*回答:\*\*([\s\S]*)$/);
      const answer = (m ? m[1] : "").replace(/<!--[\s\S]*?-->/g, "").trim();
      out.push(`${title}\n→ ${answer || "未回答"}`);
    }
    console.log(out.join("\n\n"));
    break;
  }
  case "end": {
    for (const f of [qfile, marker]) if (existsSync(f)) unlinkSync(f);
    const r = spawnSync(process.execPath, [join(import.meta.dirname, "..", "..", "cradle", "scripts", "ddd-clean-check.mjs"), ...(opts["no-build"] ? [] : ["--build"])], { cwd: cfg.root, encoding: "utf8" });
    process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? "");
    process.exit(r.status ?? 1);
  }
  case "status": {
    const read = (f) => existsSync(join(ddd, f)) ? readFileSync(join(ddd, f), "utf8") : "";
    const tl = read("event-timeline.md");
    const events = (tl.match(/^\|\s*\d+(?:\.\d+)?[a-z]?\s*\|/gm) ?? []).length;
    const hs = read("hotspots.md"), ux = read("ux-review.md"), mq = read("model-review.md"), ul = read("ubiquitous-language.md");
    const terms = (ul.match(/^\|(?!\s*用語)(?!---)[^|]+\|/gm) ?? []).length;
    console.log(JSON.stringify({
      events, hotspots: { open: countRows(hs, "HS-\\d+", "open"), resolved: countRows(hs, "HS-\\d+", "resolved") },
      ux: { open: countRows(ux, "UX-\\d+", "open") }, mq: { open: countRows(mq, "MQ-\\d+", "open") }, terms,
      session: existsSync(marker), questionsPending: existsSync(qfile),
    }, null, 2));
    break;
  }
  default:
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter(l => l.startsWith("//")).map(l => l.slice(3)).join("\n"));
    process.exit(cmd ? 1 : 0);
}
