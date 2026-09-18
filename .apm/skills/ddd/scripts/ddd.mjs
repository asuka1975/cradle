#!/usr/bin/env node
// ddd — 探索セッションの中継を機械にする。
//   ddd.mjs start [--domain "<一言>"]  5 ファイルの存在確認 + .session 印（hook が documents/ddd の編集を許す。lean/ の sha256 も記録する）+ event-timeline.md 冒頭のプロダクトの一言を出す（置き場のままなら止まる。--domain で書く）+ 用語集に無い Lean の名前を documents/ddd/naming.md に書く
//   ddd.mjs questions @file|-         explorer の [QUESTIONS] JSON → documents/ddd/questions.md（改変せず写す）
//   ddd.mjs answers                   questions.md の回答欄 → 「質問 → 回答」（explorer に返す文面）
//   ddd.mjs end [--abandon]           questions.md・naming.md を消し、ddd-clean-check --build に .session（開始時点の lean/）を渡す。通れば .session も消す（answers を中継した後でだけ通る。問いを捨てるなら --abandon）
//   ddd.mjs status                    プロダクトの一言・出来事数・open の HS/UX/MQ・用語数・命名の確認待ち
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, parseArgs, jsonArg, fail, scaffoldSampleFiles, leanVocabulary, glossaryEnglish, leanSnapshot, git, rel, productLine, PRODUCT_PLACEHOLDER } from "../../cradle/scripts/lib.mjs";

const opts = parseArgs(process.argv.slice(2), { abandon: "bool", "no-build": "bool", help: "bool" });
const [cmd, arg] = opts._;
const cfg = loadConfig();
const ddd = join(cfg.root, cfg.documents.ddd);
const FILES = ["event-timeline.md", "hotspots.md", "ubiquitous-language.md", "ux-review.md", "model-review.md"];
const qfile = join(ddd, "questions.md");
const nfile = join(ddd, "naming.md");
const marker = join(ddd, ".session");
const timeline = join(ddd, "event-timeline.md");
// .session には開始時点の lean/ の sha256、問いの版（sha256）、その版の回答を answers で中継したかを記録する。
// end は lean/ を開始時点と比べ（HEAD と比べると未コミットの形式化が差分に出る）、explorer が回答を受け取らないまま片付けるのを止める。
const sha = (t) => createHash("sha256").update(t).digest("hex");
const readSession = () => { try { return JSON.parse(readFileSync(marker, "utf8")); } catch { return null; } };
const writeSession = (s) => writeFileSync(marker, JSON.stringify(s) + "\n");
// lean/ が骨格のサンプル（メモ）のままなら、プローブもモックアップも無い巡になる（サンプルは実ドメインではない）
const scaffold = scaffoldSampleFiles(cfg).length > 0;
// 形式化が付けた名前のうち用語集に行が無いもの。用語集が唯一の正本で、行が立てば一覧から消える
const unlistedNames = () => { const glossary = glossaryEnglish(cfg); return leanVocabulary(cfg).filter(v => !glossary.has(v.name.toLowerCase())); };

function countRows(text, idRe, statusRe) {
  return (text.match(new RegExp(`^\\|\\s*${idRe}\\s*\\|.*\\|\\s*${statusRe}\\s*\\|`, "gm")) ?? []).length;
}

switch (cmd) {
  case "start": {
    // 前のセッションの印が残ったまま記録し直すと、残っているプローブが「開始時点」に入って end を通る
    if (existsSync(marker)) fail(`前のセッション（${cfg.documents.ddd}/.session）が end されていません。プローブを片付けて ddd.mjs end を先に実行する。前の探索は終わっていて lean/ の変更が形式化（フェーズ 2）なら、${cfg.documents.ddd}/.session を消してから start する`);
    const missing = FILES.filter(f => !existsSync(join(ddd, f)));
    if (missing.length) fail(`${cfg.documents.ddd}/ に無いファイル: ${missing.join(", ")}（cradle-init スキルで骨格を作る）`);
    // プロダクトの一言（event-timeline.md 冒頭の `プロダクト:` 行）は探索役の最初の問いの出発点。無いまま始めない
    if (opts.domain !== undefined) {
      if (opts.domain === true || !String(opts.domain).trim()) fail("--domain には一言（空でない文字列）が要ります");
      const text = readFileSync(timeline, "utf8");
      const line = `プロダクト: ${String(opts.domain).trim()}`;
      // 置換は関数で渡す（一言に $ が含まれても置換パターンとして読まれない）
      const replaced = /^プロダクト[:：].*$/m.test(text) ? text.replace(/^プロダクト[:：].*$/m, () => line)
        : text.replace(/^(# [^\n]*\n)/, (h) => `${h}\n${line}\n`);
      writeFileSync(timeline, replaced === text ? `${line}\n\n${text}` : replaced);
    }
    const product = productLine(cfg);
    if (product.value === null || product.placeholder) fail(`プロダクトの一言が無い（${cfg.documents.ddd}/event-timeline.md 冒頭の「プロダクト:」行${product.value === null ? "が無い" : `が ${PRODUCT_PLACEHOLDER} のまま`}）。ddd.mjs start --domain "<一言>" で書くか、cradle-init スキルの --domain で敷く`);
    console.log(`プロダクト: ${product.value}`);
    writeSession({ theme: opts.theme ?? null, scaffold, lean: leanSnapshot(cfg) });
    console.log(`セッション開始（${cfg.documents.ddd}/.session）。終わりに ddd.mjs end を必ず実行する。`);
    let uncommitted = "";
    try { uncommitted = git(cfg.root, ["status", "--porcelain", "--", cfg.lean.dir]); } catch {}
    if (uncommitted) console.log(`${cfg.lean.dir}/ に未コミットの差分がある（前回の形式化？）。end はこの時点と比べるので探索の邪魔にはならないが、プローブの戻しに git checkout / stash を使うとこの差分ごと消える — 戻すのは編集を手で。`);
    if (scaffold) console.log(`${cfg.lean.dir}/ は骨格のサンプルドメイン（メモ）のまま。実ドメインではないので探索の根拠にせず、この巡はプローブもモックアップも使わない（questions.md にモックアップ欄は出ない）。`);
    else {
      const names = unlistedNames();
      if (names.length) {
        writeFileSync(nfile, ["# モデルが付けた名前の確認", "",
          "> これは一時ファイルです。ddd.mjs start が Lean と用語集から機械で作り、end で消します。コミットしないでください。",
          "> ここに並ぶのはモデル（形式化役）が付けた名前で、エキスパートの発言ではありません。用語集に行が立った名前は次回から出ません。", "",
          "| 種類 | 識別子 | 暫定の呼び名（docstring） | 場所 |", "|---|---|---|---|",
          ...names.map(v => `| ${v.kind} | ${v.name} | ${v.doc} | ${rel(cfg.root, v.file)}:${v.line} |`), ""].join("\n"));
        console.log(`命名の確認待ち ${names.length} 件（${cfg.documents.ddd}/naming.md）`);
      }
    }
    break;
  }
  case "questions": {
    if (opts.help || arg === undefined) fail("usage: ddd.mjs questions @file | -   （explorer の [QUESTIONS] JSON をファイルか stdin で）");
    const j = jsonArg(arg);
    if (!j || !Array.isArray(j.questions) || !j.questions.length) fail("JSON は {questions:[{question, header, multiSelect, options:[{label, description}]}]} の形");
    const lines = ["# 探索セッションの問い", "", "> これは一時ファイルです。ddd スキルが作り、回答が済んだら削除します。コミットしないでください。", ""];
    if (j.theme) lines.push(`テーマ: ${j.theme}`, "");
    if (j.preface) lines.push(j.preface, "");
    if (scaffold) lines.push("モデルはまだ骨格のサンプル（実ドメインは未形式化）なので、この巡にプローブは無い。業務の事実として答えてください。", "");
    else lines.push("## 確かめ方", "", "選択肢ごとに「選ぶとどうなるか」をモデルで動かせます。", "", "```bash",
      `cd ${cfg.lean.dir} && lake build && node mockup/server.mjs   # → http://localhost:${cfg.ports.mockup}`, "```", "",
      "画面の「シナリオ」から、下の表の「モックアップ」欄の名前を選んでください。表示されるのはモデルを実際に動かした結果です。", "");
    j.questions.forEach((q, i) => {
      const n = i + 1;
      lines.push(`## Q${n}. ${q.question}${q.multiSelect ? "（複数選択可）" : ""}`);
      // 選択肢の無い問い（命名の確認など、自由記述だけの問い）には表を出さない
      if ((q.options ?? []).length) lines.push("", scaffold ? "| | 選択肢 | 選ぶとどうなるか |" : "| | 選択肢 | 選ぶとどうなるか | モックアップ |", scaffold ? "|---|---|---|" : "|---|---|---|---|");
      (q.options ?? []).forEach((o, k) => {
        const letter = String.fromCharCode(97 + k);
        lines.push(`| **${letter}** | ${o.label} | ${o.description ?? ""} |${scaffold ? "" : ` \`probe-q${n}-${letter}\` |`}`);
      });
      lines.push("", "**回答:**", "", "<!-- 選択肢の記号か、自由に書いてください。「前提が違う」「問いが成り立たない」もそのまま。 -->", "");
    });
    writeFileSync(qfile, lines.join("\n"));
    writeSession({ ...(readSession() ?? { theme: null }), questions: sha(lines.join("\n")), answered: null });
    console.log(`${cfg.documents.ddd}/questions.md に ${j.questions.length} 問を書いた。${scaffold ? "骨格のサンプルのままなのでプローブ欄は無い。" : "プローブ名は仮置き（用意できない選択肢は — と理由に書き換える）。"}`);
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
    const s = readSession();
    if (s) writeSession({ ...s, answered: sha(text) });
    break;
  }
  case "end": {
    const s = readSession();
    if (existsSync(qfile) && !opts.abandon) {
      if (!s || s.answered !== sha(readFileSync(qfile, "utf8"))) fail("questions.md の回答がまだ中継されていません。ddd.mjs answers を実行して出力を explorer に返してから end する。問いを捨てて終えるなら --abandon（ユーザーがそう決めたときだけ）");
    }
    // 開始時点の記録（.session）は検査が通るまで残す — 残骸を消して end をやり直すときも同じ基準で比べる。記録の無い印（start を経ていない）は先に消し、検査は HEAD と比べる
    const baseline = s?.lean ? ["--baseline", marker] : [];
    for (const f of [qfile, nfile, ...(baseline.length ? [] : [marker])]) if (existsSync(f)) unlinkSync(f);
    const r = spawnSync(process.execPath, [join(import.meta.dirname, "..", "..", "cradle", "scripts", "ddd-clean-check.mjs"), ...(opts["no-build"] ? [] : ["--build"]), ...baseline], { cwd: cfg.root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? "");
    if (r.status === 0 && baseline.length) unlinkSync(marker);
    process.exit(r.status ?? 1);
  }
  case "status": {
    const read = (f) => existsSync(join(ddd, f)) ? readFileSync(join(ddd, f), "utf8") : "";
    const tl = read("event-timeline.md");
    const events = (tl.match(/^\|\s*\d+(?:\.\d+)?[a-z]?\s*\|/gm) ?? []).length;
    const hs = read("hotspots.md"), ux = read("ux-review.md"), mq = read("model-review.md"), ul = read("ubiquitous-language.md");
    const terms = (ul.match(/^\|(?!\s*用語)(?!---)[^|]+\|/gm) ?? []).length;
    console.log(JSON.stringify({
      product: productLine(cfg).value,
      events, hotspots: { open: countRows(hs, "HS-\\d+", "open"), resolved: countRows(hs, "HS-\\d+", "resolved") },
      ux: { open: countRows(ux, "UX-\\d+", "open") }, mq: { open: countRows(mq, "MQ-\\d+", "open") }, terms,
      session: existsSync(marker), questionsPending: existsSync(qfile), namingPending: scaffold ? 0 : unlistedNames().length, scaffoldSample: scaffold,
    }, null, 2));
    break;
  }
  default:
    // 使い方は先頭の連続したコメント行（本文のコメントは含めない）
    const usage = [];
    for (const l of readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1)) { if (!l.startsWith("//")) break; usage.push(l.slice(3)); }
    console.log(usage.join("\n"));
    process.exit(cmd ? 1 : 0);
}
