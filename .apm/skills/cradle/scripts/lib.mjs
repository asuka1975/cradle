// Cradle 共通ライブラリ — 設定の読み込み・Lean CLI 呼び出し・小道具。
// 依存は Node 標準ライブラリだけ（配布先に何も入れさせない）。
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync, spawnSync, spawn } from "node:child_process";
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
    e2e: { dir: "e2e", ...(raw.e2e ?? {}) },
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
