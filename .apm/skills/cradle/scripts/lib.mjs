// Cradle 共通ライブラリ — 設定の読み込み・Lean CLI 呼び出し・小道具。
// 依存は Node 標準ライブラリだけ（配布先に何も入れさせない）。
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve, relative, sep } from "node:path";

/** プロジェクトルート: CRADLE_PROJECT_DIR > CLAUDE_PROJECT_DIR > cradle.json を持つ祖先 > cwd */
export function findProjectRoot(start = process.cwd()) {
  for (const env of ["CRADLE_PROJECT_DIR", "CLAUDE_PROJECT_DIR"]) {
    if (process.env[env]) return resolve(process.env[env]);
  }
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "cradle.json"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

/** cradle.json を読み、既定値で埋める。project 名だけあれば動く。 */
export function loadConfig(root = findProjectRoot()) {
  const file = process.env.CRADLE_CONFIG ?? join(root, "cradle.json");
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
    infra: { dir: "infra", ...(raw.infra ?? {}) },
    ports: { mockup: 8787, frontend: 5173, backend: 8080, idp: 8090, ...(raw.ports ?? {}) },
    protected: raw.protected ?? ["documents/developer/**"],
    unslop: raw.unslop ?? {},
    raw,
  };
  cfg.lean.rootDir = join(root, cfg.lean.dir);
  cfg.lean.modelDir = join(cfg.lean.rootDir, cfg.lean.root);
  cfg.lean.bin = join(cfg.lean.rootDir, ".lake", "build", "bin", cfg.lean.exe);
  return cfg;
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

/** Lean CLI を 1 リクエスト 1 プロセスで呼ぶ。stdin に JSON、stdout に JSON。 */
/** Lean CLI を 1 回呼ぶ（Promise）。stdin は非同期に流す — Codex のサンドボックスでは spawnSync に input を渡すと EOF が届かず固まる。 */
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

export function ensureLeanBinary(cfg, build = "auto") {
  if (build === "never") {
    if (!existsSync(cfg.lean.bin)) throw new Error(`Lean CLI がありません: ${cfg.lean.bin}（cd ${cfg.lean.dir} && lake build）`);
    return;
  }
  if (build === "always" || !existsSync(cfg.lean.bin)) lakeBuild(cfg);
}

export function lakeBuild(cfg) {
  const r = spawnSync("lake", ["build"], { cwd: cfg.lean.rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    const err = new Error(`lake build が失敗しました:\n${(r.stdout ?? "").slice(-4000)}\n${(r.stderr ?? "").slice(-4000)}`);
    err.exitCode = 2;
    throw err;
  }
  return r.stdout;
}

/** `lake env lean` で Lean の断片を評価する（#print / #check / #eval）。 */
export function leanEval(cfg, source, { timeoutMs = 120000 } = {}) {
  const tmp = join(process.env.TMPDIR ?? "/tmp", `cradle-query-${process.pid}-${Date.now()}.lean`);
  writeFileSync(tmp, source);
  try {
    const r = spawnSync("lake", ["env", "lean", tmp], { cwd: cfg.lean.rootDir, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  } finally { try { unlinkSync(tmp); } catch {} }
}

export function git(root, args, opts = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...opts }).trimEnd();
}

export function readJson(file) { return JSON.parse(readFileSync(file, "utf8")); }

export function walk(dir, { ext = null, skip = [".lake", "node_modules", "build", ".git", "dist"] } = {}) {
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
  for (const f of walk(cfg.lean.rootDir, { skip: [".lake", "node_modules", "build", ".git", "dist", "lake-manifest.json"] })) {
    out[rel(cfg.lean.rootDir, f)] = createHash("sha256").update(readFileSync(f)).digest("hex");
  }
  return out;
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

export function parseArgs(argv, spec = {}) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const eq = key.indexOf("=");
      if (eq >= 0) { opts[key.slice(0, eq)] = key.slice(eq + 1); continue; }
      if (spec[key] === "bool") { opts[key] = true; continue; }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) opts[key] = true;
      else { opts[key] = next; i++; }
    } else opts._.push(a);
  }
  return opts;
}

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
    // 宣言の検出はコメントを消した写しで行う（行数は変えない。ブロック（docstring を含む）を先に消してから行コメント）。docstring は元テキストから取る
    const code = raw.replace(/\/-[\s\S]*?-\//g, (m) => m.replace(/[^\n]/g, "")).replace(/--.*$/gm, "").split("\n");
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

/** golden の流れ: `<golden>/<name>-flow.json` の trace を手の列 { command, actor, payload, outcome } に写す。
    outcome は applied（通った）/ refused（domainError）/ protocol-error。payload は command の中身（無いコマンドでは undefined）。 */
export function goldenFlows(cfg) {
  const dir = join(cfg.root, cfg.lean.golden);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith("-flow.json")).sort().map(f => {
    const trace = JSON.parse(readFileSync(join(dir, f), "utf8")).ok?.trace ?? [];
    return { id: f.replace(/-flow\.json$/, ""), steps: trace.map(t => { const command = commandNameOf(t.command); return { command, actor: t.actor ?? null, payload: t.command?.[command], outcome: outcomeOf(t) }; }) };
  });
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
    手の列の要素は command（構成子名）・actor・outcome と、書いてあれば payload。形の合わないファイルは台本ではないので数えない。 */
export function scenarioScripts(cfg, place) {
  const root = resolve(cfg.root, place);
  if (!existsSync(root)) return [];
  const files = statSync(root).isDirectory() ? walk(root, { ext: [".json"] }) : [root];
  const out = [];
  for (const file of files) {
    let j; try { j = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    const flows = Array.isArray(j?.flows) ? j.flows : [j];
    for (const fl of flows) {
      if (!Array.isArray(fl?.steps) || !fl.steps.every(s => s && typeof s.command === "string" && typeof s.outcome === "string")) continue;
      out.push({ id: fl.id ?? null, file: rel(cfg.root, file), steps: fl.steps.map(s => ({ command: s.command, actor: s.actor ?? null, outcome: s.outcome, ...(s.payload !== undefined ? { payload: s.payload } : {}) })) });
    }
  }
  return out;
}

/** golden の流れが台本に対応しているか: 手の列（command・actor・outcome）が同じ順で台本にあれば対応。
    台本の手に payload が書いてあれば golden の command の中身とも一致を要る（無ければ手の列だけで合う）。
    台本 1 本が対応する流れは 1 本 — 手の列が同じ流れが複数あっても、台本の本数を超えては数えない。 */
export function e2eCoverage(cfg, place = cfg.e2e.scenarios) {
  const golden = goldenFlows(cfg);
  const scripts = scenarioScripts(cfg, place);
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const stepMatches = (g, s) => g.command === s.command && g.outcome === s.outcome && same(g.actor, s.actor) && (s.payload === undefined || same(g.payload, s.payload));
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

/** 用語集の英語候補 → 用語。`/`・`、`・`,` で割り、空白を除いて小文字化した名前で引く。 */
export function glossaryEnglish(cfg) {
  const map = new Map();
  for (const line of readFileSync(join(cfg.root, cfg.documents.ddd, "ubiquitous-language.md"), "utf8").split("\n")) {
    const cells = line.split("|").map(c => c.trim());
    if (cells.length < 4 || !cells[1] || cells[1] === "用語" || /^-+$/.test(cells[1])) continue;
    for (const e of cells[2].split(/[\/、,]/).map(x => x.trim()).filter(Boolean)) map.set(e.replace(/\s+/g, "").toLowerCase(), cells[1]);
  }
  return map;
}
