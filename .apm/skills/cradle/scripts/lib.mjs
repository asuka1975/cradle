// Cradle 共通ライブラリ — 設定の読み込み・Lean CLI 呼び出し・小道具。
// 依存は Node 標準ライブラリだけ（配布先に何も入れさせない）。
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
/** プロジェクトルート: CRADLE_PROJECT_DIR > CLAUDE_PROJECT_DIR > cradle.json を持つ祖先 > cwd。変数は env から読む（既定は process.env） */
export function findProjectRoot(start = process.cwd(), env = process.env) {
  for (const name of ["CRADLE_PROJECT_DIR", "CLAUDE_PROJECT_DIR"]) {
    if (env[name]) return resolve(env[name]);
  }
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "cradle.json"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

/** cradle.json を読み、既定値で埋める。project 名だけあれば動く。CRADLE_CONFIG は env から読む（既定は process.env） */
export function loadConfig(root = findProjectRoot(), env = process.env) {
  const file = env.CRADLE_CONFIG ?? join(root, "cradle.json");
  let raw = {};
  if (existsSync(file)) {
    try { raw = JSON.parse(readFileSync(file, "utf8")); }
    catch (e) { throw new Error(`cradle.json を読めません: ${file}: ${e.message}`); }
  }
  const project = raw.project ?? guessProject(root);
  if (!project) throw new Error("cradle.json に project（Lean のルート名前空間）が要ります");
  const leanDir = raw.lean?.dir ?? "lean";
  const cfg = {
    root,
    file,
    project,
    lean: {
      dir: leanDir,
      root: raw.lean?.root ?? project,
      exe: raw.lean?.exe ?? project.toLowerCase(),
      golden: raw.lean?.golden ?? `${leanDir}/golden`,
      mockup: raw.lean?.mockup ?? `${leanDir}/mockup`,
      sorryMax: raw.lean?.sorryMax ?? 0,
      entityImportAllow: raw.lean?.entityImportAllow ?? ["Application/RepositoryState.lean", "Application/Projection.lean"],
      forbiddenMentions: raw.lean?.forbiddenMentions ?? ["Lean2Kotlin"],
      ...(raw.lean ?? {}),
    },
    backend: {
      dir: "backend",
      generated: ["backend/src/generated"],
      regenerate: "./gradlew generateKotlinFromLean",
      build: "./gradlew build",
      test: "./gradlew test",
      ...(raw.backend ?? {}),
    },
    frontend: {
      dir: "frontend",
      generated: ["frontend/src/api/generated"],
      genApi: "pnpm gen:api",
      ...(raw.frontend ?? {}),
    },
    documents: {
      dir: "documents",
      ddd: "documents/ddd",
      aiNotes: "documents/ai-notes",
      developer: "documents/developer",
      infraDesign: "documents/infra-design",
      openapi: "documents/codebase/openapi.yaml",
      ...(raw.documents ?? {}),
    },
    e2e: { dir: raw.e2e?.dir ?? "e2e", scenarios: `${raw.e2e?.dir ?? "e2e"}/scenarios`, ...(raw.e2e ?? {}) },
    api: { outletsWithoutEndpoint: [], ...(raw.api ?? {}) },
    infra: { dir: "infra", ...(raw.infra ?? {}) },
    ports: { mockup: 8787, frontend: 5173, backend: 8080, idp: 8090, ...(raw.ports ?? {}) },
    protected: raw.protected ?? ["documents/developer/**"],
    unslop: { ...(raw.unslop ?? {}) },
    raw,
  };
  // 配列のキーは文字列 1 つも 1 要素の配列として読む。文字列のままだと .some / .map が投げて hook は保護の拒否ごと黙って通し、
  // スプレッド・for...of・Set は 1 文字ずつに割る（regen-impact の git に b a c k … を渡す）
  for (const [o, key] of [[cfg, "protected"], [cfg.backend, "generated"], [cfg.frontend, "generated"], [cfg.lean, "entityImportAllow"], [cfg.lean, "forbiddenMentions"],
    [cfg.api, "outletsWithoutEndpoint"], [cfg.infra, "containers"], ...["disable", "extraHedges", "ignorePaths", "skipFiles"].map(k => [cfg.unslop, k])]) {
    if (typeof o[key] === "string") o[key] = [o[key]];
  }
  cfg.lean.rootDir = join(root, cfg.lean.dir);
  cfg.lean.modelDir = join(cfg.lean.rootDir, cfg.lean.root);
  cfg.lean.bin = join(cfg.lean.rootDir, ".lake", "build", "bin", cfg.lean.exe);
  return cfg;
}

/** 道具の入口の loadConfig: 読めない・project が無い設定は `cradle: <理由>` で終える（スタックトレースにしない）。hook は自分で握って通す。 */
export function loadConfigOrFail(root) {
  try { return loadConfig(root); } catch (e) { fail(e.message); }
}

/** 骨格のサンプルドメイン（メモ）が残っている Lean ファイル。空なら実ドメインが形式化済み。マーカーの無い古い骨格はサンプルの docstring で拾う。 */
export function scaffoldSampleFiles(cfg) {
  if (!existsSync(cfg.lean.modelDir)) return [];
  return walk(cfg.lean.modelDir, { ext: [".lean"] }).filter(f => {
    const t = readFileSync(f, "utf8");
    return t.includes("Cradle の骨格のサンプルドメイン") || t.includes("メモ。書いた本人だけが閉じられる");
  });
}

/** cradle.json が無いとき: lean/lakefile.toml の lean_lib 名からルート名前空間を推測する。 */
function guessProject(root) {
  const lakefile = join(root, "lean", "lakefile.toml");
  if (!existsSync(lakefile)) return null;
  const text = readFileSync(lakefile, "utf8");
  const libs = [...text.matchAll(/\[\[lean_lib\]\]\s*\n\s*name\s*=\s*"([^"]+)"/g)].map(m => m[1]);
  const candidates = libs.filter(n => existsSync(join(root, "lean", n)) && statSync(join(root, "lean", n)).isDirectory());
  return candidates[candidates.length - 1] ?? libs[libs.length - 1] ?? null;
}

/** Lean CLI を 1 リクエスト 1 プロセスで呼ぶ（Promise）。stdin に JSON、stdout に JSON。stdin は非同期に流す — Codex のサンドボックスでは spawnSync に input を渡すと EOF が届かず固まる。 */
export function callLean(cfg, request, { build = "auto" } = {}) {
  ensureLeanBinary(cfg, build);
  const input = typeof request === "string" ? request : JSON.stringify(request);
  return new Promise((resolve, reject) => {
    const p = spawn(cfg.lean.bin, [], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.setEncoding("utf8"); p.stderr.setEncoding("utf8");
    p.stdout.on("data", d => { out += d; }); p.stderr.on("data", d => { err += d; });
    p.on("error", reject);
    p.on("close", (status) => {
      const text = out.trim();
      if (!text) return reject(new Error(`Lean CLI が何も返しませんでした (exit ${status}): ${err}`));
      try { resolve(JSON.parse(text)); }
      catch { reject(new Error(`Lean CLI の応答が JSON ではありません: ${text.slice(0, 400)}`)); }
    });
    p.stdin.on("error", () => {});
    p.stdin.end(input);
  });
}

/** spec-query・golden-check の --build の値: 既定は auto（バイナリが無ければ lake build）、ほかに always と never。値の無い --build と綴りの違う値は使い方の誤りで止める（auto と読み替えない）。 */
export function buildMode(value) {
  if (value === undefined) return "auto";
  if (!["auto", "always", "never"].includes(value)) fail(`--build は auto | always | never のどれか（${value === true ? "値が無い" : value}）`);
  return value;
}

export function ensureLeanBinary(cfg, build = "auto") {
  if (build === "never") {
    if (!existsSync(cfg.lean.bin)) throw new Error(`Lean CLI がありません: ${cfg.lean.bin}（cd ${cfg.lean.dir} && lake build）`);
    return;
  }
  if (build === "always" || !existsSync(cfg.lean.bin)) lakeBuild(cfg);
}

/** 大きさの決まらない子の出力（--json の一覧・lake や git の出力）を読む上限。spawnSync / execFile の既定（1MB）では超えたところで子を止めて途中で切る
    （spawnSync は error.code が ENOBUFS）。256MB は V8 の文字列の上限（約 512MB）の内側。 */
export const CHILD_OUTPUT_MAX = 256 * 1024 * 1024;

export function lakeBuild(cfg) {
  const r = spawnSync("lake", ["build"], { cwd: cfg.lean.rootDir, encoding: "utf8", maxBuffer: CHILD_OUTPUT_MAX, stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    // lake を起動できない（PATH に無い・置き場が無い）・出力が上限を超えたときの理由は r.error にしか無い（起動できなければ stdout / stderr も無い）
    const err = new Error(`lake build が失敗しました:${r.error ? ` ${r.error.message}` : ""}\n${(r.stdout ?? "").slice(-4000)}\n${(r.stderr ?? "").slice(-4000)}`);
    err.exitCode = 2;
    throw err;
  }
  return r.stdout;
}

/** `lake env lean` で Lean の断片を評価する（#print / #check / #eval）。error は評価が終わらなかった理由（lake を起動できない・時間切れ・signal で止まった）で、
    終われば undefined — 呼び手が空の出力を「何も無い」と読まないための印。 */
export function leanEval(cfg, source, { timeoutMs = 120000 } = {}) {
  const tmp = join(process.env.TMPDIR ?? "/tmp", `cradle-query-${process.pid}-${Date.now()}.lean`);
  writeFileSync(tmp, source);
  try {
    const r = spawnSync("lake", ["env", "lean", tmp], { cwd: cfg.lean.rootDir, encoding: "utf8", timeout: timeoutMs, maxBuffer: CHILD_OUTPUT_MAX, stdio: ["ignore", "pipe", "pipe"] });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error?.message ?? (r.signal ? `killed by ${r.signal}` : undefined) };
  } finally { try { unlinkSync(tmp); } catch {} }
}

export function git(root, args, opts = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: CHILD_OUTPUT_MAX, stdio: ["ignore", "pipe", "ignore"], ...opts }).trimEnd();
}

export function readJson(file) { return JSON.parse(readFileSync(file, "utf8")); }

const DEFAULT_WALK_SKIP = Object.freeze([".lake", "node_modules", "build", ".git", "dist"]);
export function walk(dir, { ext = null, skip = DEFAULT_WALK_SKIP } = {}) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const name of readdirSync(d)) {
      if (skip.includes(name)) continue;
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) stack.push(p);
      else if (!ext || ext.some(e => name.endsWith(e))) out.push(p);
    }
  }
  return out.sort();
}

export function rel(root, p) { return relative(root, p).split(sep).join("/"); }

/** lean/ の全ファイルの sha256（lean/ からの相対パス → ハッシュ）。lake-manifest.json は lake build が書く（初回のビルドで現れる）ので数えない。 */
export function leanSnapshot(cfg) {
  const out = {};
  for (const f of walk(cfg.lean.rootDir, { skip: [...DEFAULT_WALK_SKIP, "lake-manifest.json"] })) {
    out[rel(cfg.lean.rootDir, f)] = sha256(readFileSync(f));
  }
  return out;
}

/** lean/ の HEAD との差分（git status --porcelain の行。パスはリポジトリのルートから）。--short と違って status.branch の ## 行も色も付かず、
    未追跡（残ったプローブ）は status.showUntrackedFiles に依らず出す。lake-manifest.json は lake build が書くので leanSnapshot と同じく数えない。git の外・git が無ければ投げる。 */
export function leanGitStatus(cfg) {
  return git(cfg.root, ["status", "--porcelain", "--untracked-files=normal", "--", cfg.lean.dir, `:(exclude)${cfg.lean.dir}/lake-manifest.json`]);
}

/** 素朴な glob → 正規表現（**, *, ? だけ）。 */
export function globToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\0DS\0").replace(/\*\*/g, "\0D\0").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")
    .replace(/\0DS\0/g, "(?:.*/)?").replace(/\0D\0/g, ".*");
  return new RegExp(`^${esc}$`);
}

export function matchesAny(path, globs) { return globs.some(g => globToRegExp(g).test(path)); }

/** 深い等価比較。差分は JSON ポインタ風のパス一覧で返す（最大 max 件）。 */
export function diffJson(a, b, path = "", out = [], max = 40) {
  if (out.length >= max) return out;
  if (a === b) return out;
  const ta = a === null ? "null" : Array.isArray(a) ? "array" : typeof a;
  const tb = b === null ? "null" : Array.isArray(b) ? "array" : typeof b;
  if (ta !== tb) { out.push({ path: path || "/", expected: a, actual: b }); return out; }
  if (ta === "array") {
    if (a.length !== b.length) { out.push({ path: path || "/", expected: `length ${a.length}`, actual: `length ${b.length}` }); }
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffJson(a[i], b[i], `${path}/${i}`, out, max);
    return out;
  }
  if (ta === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) {
      if (!(k in a)) out.push({ path: `${path}/${k}`, expected: undefined, actual: b[k] });
      else if (!(k in b)) out.push({ path: `${path}/${k}`, expected: a[k], actual: undefined });
      else diffJson(a[k], b[k], `${path}/${k}`, out, max);
      if (out.length >= max) return out;
    }
    return out;
  }
  out.push({ path: path || "/", expected: a, actual: b });
  return out;
}

/** `--key value` / `--key=value` / `--flag`。spec の "bool" は値を取らず、"list" は現れた順に配列へ積む（値の無い `--key` は true を積む）。
    ほかの鍵は最後の値が勝ち、次の語が `--` で始まれば値の無い true。 */
export function parseArgs(argv, spec = {}) {
  const opts = { _: [] };
  const put = (key, v) => { if (spec[key] === "list") (opts[key] ??= []).push(v); else opts[key] = v; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const eq = key.indexOf("=");
      if (eq >= 0) { put(key.slice(0, eq), key.slice(eq + 1)); continue; }
      if (spec[key] === "bool") { opts[key] = true; continue; }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) put(key, true);
      else { put(key, next); i++; }
    } else opts._.push(a);
  }
  return opts;
}

/** 値の要る鍵の値が無いか: 値の無い `--key`（parseArgs の true）か、空か空白だけの値（`--key=`・空の変数を渡した `--key ""`）。 */
export function blankArg(v) { return v === true || (typeof v === "string" && !v.trim()); }

/** `@file` なら読み込み、`-` なら stdin、それ以外は JSON 文字列として解釈。 */
export function jsonArg(v) {
  if (v === undefined || v === true) return undefined;
  if (v === "-") return JSON.parse(readFileSync(0, "utf8"));
  if (typeof v === "string" && v.startsWith("@")) return JSON.parse(readFileSync(v.slice(1), "utf8"));
  if (typeof v === "string" && /^\d+$/.test(v)) return { id: Number(v) };
  return JSON.parse(v);
}

export function fail(msg, code = 1) {
  process.stderr.write(`cradle: ${msg}\n`);
  process.exit(code);
}

/** Lean のコメントを消した写し。改行は残し（行番号と行の index を動かさない）、消した文字は空白で埋めない（`/- … -/import` の行も `^import` で拾う）。
    左から読む: コードの `--` は行末まで、`/-`（docstring の `/--` も）からはブロックで、ブロックの中の `/-` と `-/` で深さを数える。
    正規表現を 2 回かける読み方では、`/--` の `--` を行コメントとして消すと docstring の続きの行がコードに残り、行コメントの中の `/-` からブロックを開くと次の `-/` までのコードが消える。
    コードの文字列リテラル（`\"` `\\` のエスケープを越えて次の `"` まで。閉じなければ最後まで）と文字リテラルはそのまま写す。Lean の字句と同じく中の `--` `/-` でコメントを開かない（`".../-/issues"` からファイルの残りを消さない）。
    文字リテラルは `'<1 文字>'` と `'\<1 文字>'` の形だけ（`x'` `h'` の `'` は名前の一部）。ブロックの中の `"` は Lean と同じく数えない。
    生文字列 `r"…"` / `r#"…"#`（`#` は幾つでも）は開きと同じ数の `#` が続く `"` までをそのまま写す（`\` は逃がしでなく、`r"C:\"` は `\` の後の `"` で閉じる）。
    `r` の直前が名前の文字なら `r` は名前の終わりで、続く `"` は普通の文字列（`throwError"…"`）。名前の文字は Lean の isIdRest より広く、Unicode の文字・数字と `_'!?.`（`X.r` は 1 つの名前）で、直前の 2 単位を見てサロゲート対（`𝒜`）も 1 文字に読む。
    `«…»` の名前も次の `»` までをそのまま写す（Lean は中の `"` `--` `/-` と改行を名前に含める）。
    `s!"…{…}…"` の `{}` の中の文字列は追わない（引用符の対がずれても、その文字列が `--` `/-` を持たなければ写す文字は同じ）。 */
export function stripLeanComments(text) {
  let out = "", depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (depth === 0) {
      if (c === "-" && n === "-") { const e = text.indexOf("\n", i); if (e < 0) break; i = e - 1; continue; }
      if (c === "/" && n === "-") { depth = 1; i++; continue; }
      if (c === "r" && !/[\p{L}\p{N}_'!?.]$/u.test(text.slice(Math.max(0, i - 2), i))) {
        let h = 0;
        while (text[i + 1 + h] === "#") h++;
        if (text[i + 1 + h] === '"') {
          const close = '"' + "#".repeat(h), e = text.indexOf(close, i + 2 + h);
          const end = e < 0 ? text.length : e + close.length;
          out += text.slice(i, end); i = end - 1; continue;
        }
      }
      if (c === "«") {
        const e = text.indexOf("»", i + 1), end = e < 0 ? text.length : e + 1;
        out += text.slice(i, end); i = end - 1; continue;
      }
      if (c === '"') {
        let e = i + 1;
        while (e < text.length && text[e] !== '"') e += text[e] === "\\" ? 2 : 1;
        out += text.slice(i, e + 1); i = e; continue;
      }
      if (c === "'") {
        const len = n === "\\" ? 4 : 3;
        if (text[i + len - 1] === "'") { out += text.slice(i, i + len); i += len - 1; continue; }
      }
      out += c;
    } else if (c === "/" && n === "-") { depth++; i++; }
    else if (c === "-" && n === "/") { depth--; i++; }
    else if (c === "\n") out += c;
  }
  return out;
}

/** `def <defName>` の最初のブロック（次の字下げの無い行まで）にある文字列の腕 `| "<名前>" => some` の名前を出てくる順に。コメントも読む（元テキストのまま）。 */
export function leanStringArms(text, defName) {
  const m = text.match(new RegExp(`def\\s+${defName}[\\s\\S]*?(?=\\n\\S|$)`));
  return m ? [...m[0].matchAll(/\|\s*"([^"]+)"\s*=>\s*some/g)].map(c => c[1]) : [];
}

/** 出発点の名前: lean/ の .lean ファイル（walk の順）ごとの scenarioByName の腕を、重複を除いて出てくる順に。 */
export function scenarioNames(cfg) {
  const names = new Set();
  for (const f of walk(cfg.lean.rootDir, { ext: [".lean"] })) for (const n of leanStringArms(readFileSync(f, "utf8"), "scenarioByName")) names.add(n);
  return [...names];
}

/** 名前付きの環境（外部能力の script）: Runtime/Scenarios.lean の environmentByName の腕。持たないプロジェクトでは空。 */
export function environmentNames(cfg) {
  const file = join(cfg.lean.modelDir, "Runtime", "Scenarios.lean");
  return existsSync(file) ? [...new Set(leanStringArms(readFileSync(file, "utf8"), "environmentByName"))] : [];
}

/** sorry の残数: コメントを消した写しで `sorry` を含む行の数（1 行に幾つあっても 1）。lean-check が sorryMax で止める数え方と同じ。 */
export function leanSorryLines(text) { return stripLeanComments(text).split("\n").filter(l => /\bsorry\b/.test(l)).length; }

/** 形式化が付けた名前: コマンド構成子・失敗語彙・画面の口。doc は宣言直前の docstring の 1 文目（無ければ ""）。 */
export function leanVocabulary(cfg) {
  const targets = [
    { kind: "コマンド", file: "Runtime/Command.lean", decl: /^\s*inductive\s+Command\b/, member: /^\s*\|\s*(\w+)/ },
    { kind: "内部入力", file: "Runtime/Observation.lean", decl: /^\s*inductive\s+Observation\b/, member: /^\s*\|\s*(\w+)/ },
    { kind: "失敗", file: "Domain/Error.lean", decl: /^\s*inductive\s+DomainError\b/, member: /^\s*\|\s*(\w+)/ },
    { kind: "画面の口", file: "Runtime/Views.lean", decl: /^\s*structure\s+Views\b/, member: /^\s*(\w+)\s*:/ },
  ];
  const out = [];
  for (const t of targets) {
    const file = join(cfg.lean.modelDir, t.file);
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, "utf8");
    // 宣言の検出はコメントを消した写しで行う（行数は変えない）。docstring は元テキストから取る
    const code = stripLeanComments(raw).split("\n");
    const start = code.findIndex(l => t.decl.test(l));
    if (start < 0) continue;
    const indent = code[start].match(/^\s*/)[0].length;
    for (let i = start + 1; i < code.length; i++) {
      const m = code[i].match(t.member);
      if (m) { out.push({ kind: t.kind, name: m[1], doc: docstringBefore(raw, i), file, line: i + 1 }); continue; }
      // 構成子でもフィールドでもない行が宣言と同じ字下げまで戻ったら宣言の終わり（deriving・次の宣言）
      if (code[i].trim() && code[i].match(/^\s*/)[0].length <= indent) break;
    }
  }
  return out;
}

/** 行 index（0 始まり）の直前にある docstring `/-- … -/` の 1 文目（`。` の手前まで）。 */
function docstringBefore(raw, index) {
  const before = raw.split("\n").slice(0, index).join("\n").trimEnd();
  if (!before.endsWith("-/")) return "";
  const open = before.lastIndexOf("/--");
  if (open < 0) return "";
  const body = before.slice(open + 3, -2);
  if (body.includes("-/")) return "";
  return body.replace(/\s+/g, " ").trim().split("。")[0];
}

/** Markdown の表を行ごとに読む: { line（1 始まり）, cells, columns }。columns はその行が属する表の見出し（見出し行 = 次の行が区切り行）。
    行頭・行末の `|` の外側は数えない（行末の `|` が無くても最後のセルを落とさない）。`\|` は区切りにしない。 */
export function tableRows(text) {
  const lines = text.split("\n");
  const cellsOf = (l) => {
    const c = l.split(/(?<!\\)\|/).map(x => x.trim());
    c.shift();
    if (/\|\s*$/.test(l)) c.pop();
    return c;
  };
  const separator = (l) => /^\s*\|\s*:?-+/.test(l ?? "");
  const out = [];
  let columns = [];
  lines.forEach((l, i) => {
    if (!l.trimStart().startsWith("|") || separator(l)) return;
    if (separator(lines[i + 1])) { columns = cellsOf(l); return; }
    out.push({ line: i + 1, cells: cellsOf(l), columns });
  });
  return out;
}

/** 外部能力の Port: `Application/Port/<Port>/<操作>.lean`（Domain/Port も同じ）の置き場から。操作名（method）は生成器と同じ小文字始まりで、
    CLI の応答（env の script・interactions）の operation もこの名前。 */
export function ports(cfg) {
  const out = [];
  for (const layer of ["Application", "Domain"]) {
    const portDir = join(cfg.lean.modelDir, layer, "Port");
    if (!existsSync(portDir)) continue;
    for (const name of readdirSync(portDir).sort()) {
      const d = join(portDir, name);
      if (!statSync(d).isDirectory()) continue;
      const operations = readdirSync(d).filter(f => f.endsWith(".lean")).sort().map(f => {
        const op = f.replace(/\.lean$/, "");
        const module = `${cfg.lean.root}.${layer}.Port.${name}.${op}`;
        return { name: op, method: op[0].toLowerCase() + op.slice(1), module, request: `${module}.Request`, outcome: `${module}.Outcome` };
      });
      out.push({ name, layer: layer.toLowerCase(), module: `${cfg.lean.root}.${layer}.Port.${name}`, operations });
    }
  }
  return out;
}

/** 外部能力の往復 (port, operation) が Port の一覧（ports の結果）にあるか。 */
export function hasPortOperation(portList, port, operation) {
  return portList.some(p => p.name === port && p.operations.some(o => o.method === operation));
}

/** 生成された抽象テスト（names はファイル名から取ったクラス名）の配線: [{ name, adapter, wired }]。具象クラスが `: <name>(` で継承していれば配線済み。
    Adapter の適合テスト（<Port>AdapterContractTest）は adapterTest のソースセット、それ以外の契約テストは test のソースセットにだけ探す —
    抽象テストはそれぞれのソースセットにしか見えないので、src/main の同じ形は配線ではない。 */
export function contractTestWiring(cfg, names) {
  const texts = {};
  const textOf = (dir) => texts[dir] ??= walk(join(cfg.root, cfg.backend.dir, "src", dir), { ext: [".kt"] }).map(f => readFileSync(f, "utf8")).join("\n");
  return names.map(name => {
    const adapter = /AdapterContractTest$/.test(name);
    return { name, adapter, wired: new RegExp(`:\\s*${name}\\s*\\(`).test(textOf(adapter ? "adapterTest" : "test")) };
  });
}

/** sidecar の版。モックアップはこの版で書き、golden-check はこの版だけを読む。 */
export const SIDECAR_VERSION = 1;

/** golden の再生リクエスト（sidecar）: `<golden>/<name>.request.json` = {"version":1,"init":{…},"flow":{…}}。無ければ null。
    version の無い旧形式は旧経路（cmd init / flow）の golden にだけ許す（黙って受ける）— 外部能力の経路（cmd external）のリクエストを持つなら壊れている。
    version があって 1 でなければ経路に依らず読めない。読めなければ投げる（無いのと壊れているのは別の事故）。 */
export function readSidecar(goldenDir, name) {
  const file = join(goldenDir, `${name}.request.json`);
  if (!existsSync(file)) return null;
  let j; try { j = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new Error(`${name}.request.json を読めません: ${e.message}`); }
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error(`${name}.request.json が {"version":1,"init":…,"flow":…} の形ではない`);
  const versioned = Object.hasOwn(j, "version");
  if (versioned && j.version !== SIDECAR_VERSION) throw new Error(`${name}.request.json の version ${JSON.stringify(j.version)} は読めない（読める版: ${SIDECAR_VERSION}）— モックアップで採り直す`);
  const sidecar = { version: versioned ? j.version : null, init: j.init ?? null, flow: j.flow ?? null };
  if (!versioned && sidecarIsExternal(sidecar)) throw new Error(`${name}.request.json が version 無しで外部能力の経路（cmd external）のリクエストを持つ（読める形は {"version":${SIDECAR_VERSION},…}）— モックアップで採り直す`);
  return sidecar;
}

const sidecarIsExternal = (sidecar) => (sidecar.init ?? sidecar.flow)?.cmd === "external";

/** golden-check の --manifest（`{"<name>": {"scenario":…,"viewer":…,"today":…,"actor":…}}`）を読む。shown は文に出すパス（利用者が渡した形）。
    読めない（無い・ディレクトリ）・JSON でない・トップか項目がオブジェクトでなければ 1 行の理由で投げる — 呼び手は fail で止め、
    regen-impact は再生成の前に同じものを確かめる。SyntaxError の文は中身の改行を写すことがあるので 1 行に畳む。 */
export function readManifest(file, shown = file) {
  const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const shape = `{"<name>": {"scenario":…,"viewer":…,"today":…,"actor":…}}`;
  let j; try { j = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new Error(`--manifest ${shown} を JSON として読めません: ${e.message.replace(/\s*\n\s*/g, " ")}`); }
  if (!isObject(j)) throw new Error(`--manifest ${shown} が ${shape} の形ではない`);
  const bad = Object.keys(j).find(k => !isObject(j[k]));
  if (bad !== undefined) throw new Error(`--manifest ${shown} の ${JSON.stringify(bad)} がオブジェクトではない（${shape} の形）`);
  return j;
}

/** golden の応答（`<name>-init.json` / `<name>-flow.json`）を読む。読めなければどのファイルかを添えて投げる — 壊れた 1 本で status や flows-from-golden が名前の無い SyntaxError で止まらないように。 */
export function readGoldenJson(goldenDir, file) {
  try { return readJson(join(goldenDir, file)); } catch (e) { throw new Error(`${file} を JSON として読めない: ${e.message}`); }
}

/** golden の流れの応答（`<name>-flow.json`）の trace（手の応答の列）。error の応答や trace の無い ok は 0 手。
    JSON としては読めても形が違えば（オブジェクトでない・ok.trace が配列でない・手がオブジェクトでない）ファイル名を添えて投げる
    — 名前の無い TypeError で止まらず、数の手を構成子の無い applied の手として数えないように。 */
export function readGoldenTrace(goldenDir, file) {
  const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const j = readGoldenJson(goldenDir, file);
  if (!isObject(j)) throw new Error(`${file} が golden の応答（{"ok":…} か {"error":…}）の形ではない`);
  const trace = j.ok?.trace;
  if (trace === undefined) return [];
  if (!Array.isArray(trace)) throw new Error(`${file} の ok.trace が配列ではない`);
  const bad = trace.findIndex(t => !isObject(t));
  if (bad >= 0) throw new Error(`${file} の ok.trace の ${bad + 1} 手目がオブジェクトではない`);
  return trace;
}

/** 外部能力の経路（cmd external）で採った golden か。sidecar があればその init（無ければ flow）の cmd で決まる（version は見ない）。
    sidecar が無ければ応答の形で見分ける — init の応答に env があるか、flow の trace の要素に env か result があるか（旧経路の応答にはどれも無い）。 */
export function isExternalGolden(goldenDir, name) {
  const sidecar = readSidecar(goldenDir, name);
  if (sidecar) return sidecarIsExternal(sidecar);
  const initFile = `${name}-init.json`, flowFile = `${name}-flow.json`;
  if (existsSync(join(goldenDir, initFile)) && readGoldenJson(goldenDir, initFile)?.ok?.env !== undefined) return true;
  return existsSync(join(goldenDir, flowFile)) && (readGoldenJson(goldenDir, flowFile)?.ok?.trace ?? []).some(t => t && (t.env !== undefined || t.result !== undefined));
}

/** golden の環境: { name, script }。name は sidecar の環境名（script を直に渡した golden や sidecar 無しでは null）、
    script は応答の env のもの（init の応答、無ければ flow の応答の env）— E2E の駆動側が stopAt の golden で「期待したのに呼ばれなかった」尾を知るのに要る。
    どちらの応答にも env が無ければ（旧経路）null。 */
export function goldenEnvironment(goldenDir, name, sidecar) {
  const envOf = (file) => existsSync(join(goldenDir, file)) ? readGoldenJson(goldenDir, file)?.ok?.env : undefined;
  const env = envOf(`${name}-init.json`) ?? envOf(`${name}-flow.json`);
  if (!env || typeof env !== "object") return null;
  const named = [sidecar?.init?.environment, sidecar?.flow?.environment].find(n => typeof n === "string") ?? null;
  return { name: named, script: env.script };
}

/** trace の要素（か入力）に写された入力: 利用者の操作（kind command）か内部入力（kind observation）。name は構成子名、payload はその中身。 */
export function traceInputOf(t) {
  const kind = t?.observation !== undefined && t?.command === undefined ? "observation" : "command";
  const input = t?.[kind];
  const name = input === undefined ? undefined : commandNameOf(input);
  return { kind, name, payload: input && typeof input === "object" ? input[name] : undefined };
}

/** golden-check の report の 1 行分の文章: 先頭が状態と名前の行、changed にはその後に食い違い（diffs）を 1 つ 1 行で続ける。
    golden-check の文字の出力と、golden-check --json を読む regen-impact の一覧（先頭の行だけ）が同じ言い方になるよう 1 か所に置く。 */
export function goldenRowLines(r) {
  if (r.status === "ok") return [`ok       ${r.name}-${r.kind}`];
  if (r.status === "updated") return [`updated  ${r.name}-${r.kind} (${r.diffs} diffs)`];
  if (r.status === "skipped") return [`skipped  ${r.name}: ${r.reason}`];
  if (r.status === "error") return [`error    ${r.name}${r.kind ? `-${r.kind}` : ""}: ${r.reason}`];
  return [`CHANGED  ${r.name}-${r.kind}: first divergence at ${r.firstDivergence}${r.step ? ` (step #${r.step} ${r.inputKind === "observation" ? "observation " : ""}${r.command})` : ""}`,
    ...r.diffs.map(d => `           ${d.path}: expected ${JSON.stringify(d.expected)} / actual ${JSON.stringify(d.actual)}`)];
}

/** golden の流れ: `<golden>/<name>-flow.json` の trace を手の列に写す。
    手は { kind: command | observation, command か observation（構成子名）, actor（observation では null）, payload, outcome, fault? }。
    outcome は外部能力の経路の応答なら要素の result（applied / refused / fault）、旧経路なら outcomeOf の判定（applied / refused / protocol-error）。
    fault は入力が指名した障害契約の名前（trace の写し。結果が fault なら faultContract に止まった契約と portCalls が別に載る）。
    流れは external（外部能力の経路で採ったか）と environment（goldenEnvironment の { name, script }。旧経路では null）を持つ。 */
export function goldenFlows(cfg) {
  const dir = goldenDirOf(cfg);
  if (!existsSync(dir)) return [];
  return goldenFlowFiles(dir).map(f => {
    const id = f.replace(/-flow\.json$/, "");
    // 読めない応答・形の違う応答は投げる（readGoldenTrace がファイル名を添える）— 流れを黙って落とすと flows-from-golden --check の門が通ってしまう
    const trace = readGoldenTrace(dir, f);
    // 壊れた sidecar は golden-check が報告する。ここでは流れ自体は数え、sidecar の情報だけ無いものとして扱う
    let sidecar = null, external = false;
    try { sidecar = readSidecar(dir, id); external = isExternalGolden(dir, id); } catch {}
    return { id, external, environment: goldenEnvironment(dir, id, sidecar), steps: trace.map((t, i) => goldenStep(t, sidecar?.flow?.inputs?.[i])) };
  });
}

function goldenStep(t, input) {
  const { kind, name, payload } = traceInputOf(t);
  const step = { kind, [kind]: name, actor: kind === "command" ? t.actor ?? null : null, payload, outcome: stepOutcome(t) };
  // step の応答は入力の写しを持たないので、trace に無ければ sidecar の入力から
  const fault = nominatedFault(t, input);
  if (fault !== undefined) step.fault = fault;
  return step;
}

export function commandNameOf(command) {
  return command && typeof command === "object" ? Object.keys(command)[0] : String(command);
}

export function outcomeOf(traceEntry) {
  if (traceEntry.domainError !== undefined) return "refused";
  if (traceEntry.error !== undefined) return "protocol-error";
  return "applied";
}

/** 台本の置き場（ファイルかディレクトリ）から台本を読む。形は from-golden.json と同じ `steps`（`{ flows: [{ id?, steps }] }` か `{ id?, steps }` 1 本）。
    手の列の要素は kind（省略時 command）と outcome、command なら command（構成子名）・actor、observation なら observation（構成子名。当事者は無い）、
    書いてあれば payload。形の合わないファイルは台本ではないので数えない。 */
export function scenarioScripts(cfg, place) {
  const root = resolve(cfg.root, place);
  if (!existsSync(root)) return [];
  const files = statSync(root).isDirectory() ? walk(root, { ext: [".json"] }) : [root];
  const out = [];
  for (const file of files) {
    let j; try { j = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    const flows = Array.isArray(j?.flows) ? j.flows : [j];
    for (const fl of flows) {
      if (!Array.isArray(fl?.steps) || !fl.steps.every(scriptStepOk)) continue;
      out.push({ id: fl.id ?? null, file: rel(cfg.root, file), steps: fl.steps.map(scriptStep) });
    }
  }
  return out;
}

const scriptKindOf = (s) => s.kind ?? "command";
function scriptStepOk(s) {
  if (!s || typeof s !== "object" || typeof s.outcome !== "string") return false;
  const kind = scriptKindOf(s);
  return kind === "command" ? typeof s.command === "string" : kind === "observation" && typeof s.observation === "string";
}
function scriptStep(s) {
  const kind = scriptKindOf(s);
  return { kind, [kind]: s[kind], actor: kind === "command" ? s.actor ?? null : null, outcome: s.outcome, ...(s.payload !== undefined ? { payload: s.payload } : {}) };
}

/** golden の流れが台本に対応しているか: 手の列（kind と構成子名・command なら actor・outcome）が同じ順で台本にあれば対応。
    台本の手に payload が書いてあれば golden の入力の中身とも一致を要る（無ければ手の列だけで合う）。
    台本 1 本が対応する流れは 1 本 — 手の列が同じ流れが複数あっても、台本の本数を超えては数えない。
    golden は goldenFlows の流れ。status は読めない golden と辿れない台本の置き場を別の事実にするので、先に読んだ流れを渡す。 */
export function e2eCoverage(cfg, place = cfg.e2e.scenarios, golden = goldenFlows(cfg)) {
  const scripts = scenarioScripts(cfg, place);
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const stepMatches = (g, s) => g.kind === s.kind && g[g.kind] === s[s.kind] && g.outcome === s.outcome
    && (g.kind !== "command" || same(g.actor, s.actor)) && (s.payload === undefined || same(g.payload, s.payload));
  const matches = (flow, script) => flow.steps.length === script.steps.length && flow.steps.every((g, i) => stepMatches(g, script.steps[i]));
  const specificity = (script) => script.steps.filter(s => s.payload !== undefined).length;
  const free = new Set(scripts);
  const covered = [], uncovered = [];
  for (const g of golden) {
    // payload まで書いた台本を先に当てる — 手の列だけの台本を、payload の違う別の流れに取られないため
    const found = [...free].filter(s => matches(g, s)).sort((a, b) => specificity(b) - specificity(a))[0];
    if (found) { free.delete(found); covered.push(g.id); } else uncovered.push(g.id);
  }
  return { place, flows: golden, golden: golden.map(g => g.id), covered, uncovered, scripts: scripts.length };
}

/** キーの順に依らない JSON（actor の比較用）。 */
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}

/** プロダクトの一言: event-timeline.md 冒頭の `プロダクト:` 行。value は行が無ければ null、placeholder は骨格の置き場（`（一言で）`）か空のまま。 */
export const PRODUCT_PLACEHOLDER = "（一言で）";
export function productLine(cfg) {
  const file = join(cfg.root, cfg.documents.ddd, "event-timeline.md");
  if (!existsSync(file)) return { value: null, placeholder: false };
  // 空白は行内のものだけ — ラベルだけ残した行の次の行（見出しなど）を値にしない
  const m = readFileSync(file, "utf8").match(/^プロダクト[:：][ \t]*(.*)$/m);
  if (!m) return { value: null, placeholder: false };
  const value = m[1].trim();
  return { value, placeholder: !value || value === PRODUCT_PLACEHOLDER };
}

/** 用語集の英語候補 → 用語。`/`・`、`・`,` で割り、空白を除いて小文字化した名前で引く。
    用語集が無ければ空 — 名前の正本は用語集だけなので、形式化が付けた名前はどれも行が無いものとして数える（読めない用語集は投げる）。 */
export function glossaryEnglish(cfg) {
  const map = new Map();
  for (const line of readText(join(cfg.root, cfg.documents.ddd, "ubiquitous-language.md")).split("\n")) {
    const cells = line.split("|").map(c => c.trim());
    if (cells.length < 4 || !cells[1] || cells[1] === "用語" || /^-+$/.test(cells[1])) continue;
    for (const e of cells[2].split(/[\/、,]/).map(x => x.trim()).filter(Boolean)) map.set(e.replace(/\s+/g, "").toLowerCase(), cells[1]);
  }
  return map;
}

/** 中身（文字列か Buffer）の sha256 の 16 進。 */
export function sha256(data) { return createHash("sha256").update(data).digest("hex"); }

/** テキストファイルを読む。無ければ fallback。ディレクトリや読めないファイルは投げる（無いのとは別の事故）。 */
export function readText(path, fallback = "") { return existsSync(path) ? readFileSync(path, "utf8") : fallback; }

/** 探索の 5 ファイル（documents/ddd）。status と ddd start は欠けているものをこの順で出す。 */
export const DDD_FILES = Object.freeze(["event-timeline.md", "hotspots.md", "ubiquitous-language.md", "ux-review.md", "model-review.md"]);

/** 問いの台帳ごとの ID（countStatusRows の idRe）。台帳は自分の接頭辞の行だけを数える — hotspots.md に書いた MQ の行を HS の問いにしない（status と ddd status が同じ数を出す）。 */
export const DDD_QUESTION_IDS = Object.freeze({ "hotspots.md": "HS-\\d+", "ux-review.md": "UX-\\d+", "model-review.md": "MQ-\\d+" });

/** 出来事の行の数: 行頭の `|` の直後のセルが番号（`12`・`3.1`・`4a`）の行。ファイルのどの表の行も数える。 */
export function countEvents(text) { return (text.match(/^\|\s*\d+(?:\.\d+)?[a-z]?\s*\|/gm) ?? []).length; }

/** 行頭のセルが idRe（正規表現の文字列）で、3 列目以降のどれかのセルがちょうど statusRe の行の数。text が無ければ 0。 */
export function countStatusRows(text, idRe, statusRe) {
  return text ? (text.match(new RegExp(`^\\|\\s*${idRe}\\s*\\|.*\\|\\s*${statusRe}\\s*\\|`, "gm")) ?? []).length : 0;
}

/** golden の置き場（cradle.json の lean.golden）。 */
export function goldenDirOf(cfg) { return join(cfg.root, cfg.lean.golden); }

/** golden の流れのファイル（`<name>-flow.json`）をファイル名の順に。名前（接尾辞を外したもの）の順とは違う（pay-alt-flow.json は pay-flow.json の前）— e2eCoverage の当て順と出力の順はこの並び。 */
export function goldenFlowFiles(dir) { return readdirSync(dir).filter(f => f.endsWith("-flow.json")).sort(); }

/** trace の要素の結果: 外部能力の経路の応答なら要素の result（applied / refused / fault）、旧経路なら outcomeOf の判定。 */
export function stepOutcome(t) { return typeof t.result === "string" ? t.result : outcomeOf(t); }

/** 入力が指名した障害契約の名前: trace の写し、無ければ sidecar の入力（input）のもの。どちらも文字列でなければ undefined。 */
export function nominatedFault(t, input) { return typeof t.fault === "string" ? t.fault : typeof input?.fault === "string" ? input.fault : undefined; }

/** 道具の使い方: スクリプトの shebang の次から続くコメント行（`// ` を外す）。最初のコメントでない行で止め、本文のコメントは含めない。
    scriptUrl は道具の import.meta.url。設定を読まないので、プロジェクトの外でも出せる。 */
export function headerUsage(scriptUrl) {
  const usage = [];
  for (const l of readFileSync(new URL(scriptUrl), "utf8").split("\n").slice(1)) { if (!l.startsWith("//")) break; usage.push(l.slice(3)); }
  return usage.join("\n");
}

/** 道具のスクリプト（cradle/scripts/<name>）の絶対パス。他のスキルの道具も lib の置き場から引く — スキルの並び（../../cradle）を推し量らない。 */
export function cradleScript(name) { return fileURLToPath(new URL(name, import.meta.url)); }

/** 骨格の写しの改名: Sprout / sprout と __PROJECT__ / __PROJECT_LOWER__ をプロジェクト名（とその小文字）に、__DOMAIN__ をプロダクトの一言（null なら置き場）に。
    init が敷くときと doctor が骨格の最新版と比べるときで同じ改名を使う。一言は関数で渡す（$ を置換パターンとして読まない）。 */
export function renameScaffold(text, { project, domain = null }) {
  const lower = project.toLowerCase();
  return text.replace(/Sprout/g, project).replace(/sprout/g, lower).replace(/__PROJECT__/g, project).replace(/__PROJECT_LOWER__/g, lower)
    .replace(/__DOMAIN__/g, () => domain === null ? PRODUCT_PLACEHOLDER : String(domain).trim());
}

/** ai-notes の命名と冒頭の断り（hook の post-edit と unslop の ai-note-header が同じ規則を使う）。relPath が aiNotesDir の下でないか、
    README.md・TEMPLATE.md（骨格が置く案内とひな形）で終われば null。name は aiNotesDir からのパスで、サブディレクトリのノートは名前の規則に合わない。
    断りは冒頭 800 字に探し、text が null（読めない）なら noHeader は false。拡張子の絞り込みは呼ぶ側（hook は .md、unslop はドキュメントの拡張子）。 */
export function aiNoteProblems(aiNotesDir, relPath, text) {
  if (!relPath.startsWith(`${aiNotesDir}/`) || relPath.endsWith("README.md") || relPath.endsWith("TEMPLATE.md")) return null;
  const name = relPath.slice(aiNotesDir.length + 1);
  return { name, badName: !/^\d{8}-\d{2}-[a-z0-9-]+\.md$/.test(name), noHeader: text !== null && !/規約ではありません/.test(text.slice(0, 800)) };
}
