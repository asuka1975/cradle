#!/usr/bin/env node
// mockup-build — Lean モデルをブラウザだけで動く wasm に束ねる（モックアップとフロントエンドの dev の相手）
//   mockup-build [--build always|never] [--meta-only]
//     <lean.mockup>/public/lean.js  wasm を埋め込んだ 1 枚（createCradleLean() が「リクエスト文字列 → 応答文字列」の関数を返す）
//     <lean.mockup>/public/meta.js  spec-query meta の結果 + 用語集（globalThis.CRADLE_META）
//   --build never  lake build を走らせない（既定は毎回走らせる — wasm は今のモデルでないと意味がない）
//   --meta-only    meta.js だけ作り直す（用語集を直しただけのとき。emcc は要らない）
//   置く前に golden のリクエストと全シナリオをネイティブの CLI にも流し、応答が 1 バイトでも違えば置かずに止まる
//   要るもの: PATH の emcc（emsdk）。ランタイムと標準ライブラリの生成物は CRADLE_WASM_CACHE（既定 ~/.cache/cradle/lean-wasm）に残す
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHILD_OUTPUT_MAX, callLeanText, cradleScript, fail, glossaryEnglish, goldenDirOf, headerUsage, lakeBuild, loadConfigOrFail, parseArgs, readSidecar, readableEntries, sha256, walk } from "./lib.mjs";
import { initSchedule, initSource, localPathIn, prunedSource, reach, symbolIndex } from "./wasm-closure.mjs";

const opts = parseArgs(process.argv.slice(2), { help: "bool", "meta-only": "bool" });
if (opts.help) { console.log(headerUsage(import.meta.url)); process.exit(0); }
const buildOpt = opts.build ?? "always";
if (!["always", "never"].includes(buildOpt)) fail(`--build は always | never のどれか（${buildOpt === true ? "値が無い" : buildOpt}）`);

/** 動作を確かめた Emscripten の版。違う版でも動かすが、1 行知らせる（MEMORY64=2 は Emscripten が廃止を検討している）。 */
const TESTED_EMSCRIPTEN = "6.0.13";
// wasm64 の命令を 32bit のメモリに落とす。C を吐いた Lean（64bit）と同じ幅なので USize も静的データもネイティブと揃い、ブラウザの Memory64 対応も要らない
const TARGET = ["-sMEMORY64=2", "-fwasm-exceptions"];
// -DNDEBUG と -ffp-contract=off はネイティブ（Lake の release と leanc）に揃える。-DNDEBUG が無いと lean.h の assert が wasm でだけ生き、手元のパスも lean.js に残る
const OPTIMIZE = ["-O2", "-w", "-DNDEBUG", "-ffp-contract=off"];
// タスクの管理・libuv・OpenSSL は使わない。uv/* と openssl.cpp は要らない（libuv.cpp は初期化の入口だけ）
const RUNTIME_SOURCES = ["debug", "thread", "mpz", "utf8", "object", "apply", "exception", "interrupt", "memory", "stackinfo", "compact", "init_module", "io", "hash", "byteslice", "platform", "alloc", "allocprof", "sharecommon", "stack_overflow", "process", "object_ref", "mpn", "mutex", "libuv"];
const ASSETS = fileURLToPath(new URL("../assets/wasm/", import.meta.url));

const cfg = loadConfigOrFail();
const publicDir = join(cfg.root, cfg.lean.mockup, "public");
const WORKERS = Math.max(2, availableParallelism());

/** 子を走らせて stdout を返す。失敗はそのまま理由にする。 */
function run(cmd, args, { cwd, env, what } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.setEncoding("utf8"); p.stderr.setEncoding("utf8");
    p.stdout.on("data", d => { out += d; }); p.stderr.on("data", d => { err += d; });
    p.on("error", e => reject(new Error(`${what ?? cmd} を起動できない: ${e.message}`)));
    p.on("close", code => code === 0 ? resolve(out) : reject(new Error(`${what ?? cmd} が失敗した（exit ${code}）:\n${err.slice(-4000)}\n${out.slice(-1000)}`)));
  });
}

/** 並列数を絞って順に流す。結果は入力の順。 */
async function pool(items, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(WORKERS, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

/** プロジェクトの Lean の置き場・版・コミット（ランタイムのソースをこのコミットで取る）。 */
function leanFacts() {
  const lean = (args) => {
    const r = spawnSync("lean", args, { cwd: cfg.lean.rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (r.status !== 0) fail(`lean ${args.join(" ")} が失敗した: ${r.error?.message ?? r.stderr}`);
    return r.stdout.trim();
  };
  const version = lean(["--version"]);
  const m = version.match(/version (\S+?),.*commit ([0-9a-f]{7,})/);
  if (!m) fail(`lean --version を読めない: ${version}`);
  return { prefix: lean(["--print-prefix"]), version: m[1], commit: m[2] };
}

function emccVersion() {
  const r = spawnSync("emcc", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) fail(`emcc が見つからない（wasm には Emscripten が要る）。入れ方:\n  git clone https://github.com/emscripten-core/emsdk.git && cd emsdk\n  ./emsdk install ${TESTED_EMSCRIPTEN} && ./emsdk activate ${TESTED_EMSCRIPTEN} && source ./emsdk_env.sh\n用語集だけ直したなら --meta-only は emcc なしで動く。`);
  const v = r.stdout.match(/\) (\d+\.\d+\.\d+)/)?.[1];
  if (!v) fail(`emcc --version を読めない: ${r.stdout.slice(0, 200)}`);
  return v;
}

/** このコミットの Lean のランタイムのソースをキャッシュに取る。 */
async function runtimeSource(cache, commit) {
  const dir = join(cache, "src");
  if (existsSync(join(dir, "src", "runtime", "object.cpp"))) return join(dir, "src");
  const url = `https://github.com/leanprover/lean4/archive/${commit}.tar.gz`;
  console.log(`  Lean のランタイムのソースを取得: ${url}`);
  let res;
  try { res = await fetch(url); } catch (e) { fail(`Lean のソースを取得できない（${url}）: ${e.message}`); }
  if (!res.ok) fail(`Lean のソースを取得できない（${url}）: HTTP ${res.status}`);
  const tmp = join(cache, `src-${process.pid}.tar.gz`);
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  const part = `${dir}.${process.pid}`;
  mkdirSync(part, { recursive: true });
  const top = `lean4-${commit}`;
  await run("tar", ["-xzf", tmp, "-C", part, "--strip-components=1", `${top}/src/runtime`, `${top}/src/util`], { what: "tar" });
  rmSync(tmp);
  rmSync(dir, { recursive: true, force: true });
  renameSync(part, dir);
  return join(dir, "src");
}

/** lean.h と、mimalloc を使わない config.h（ブラウザの wasm は標準の malloc で足りる）。 */
function includeDir(cache, prefix) {
  const inc = join(cache, "include");
  mkdirSync(join(inc, "lean"), { recursive: true });
  for (const f of ["lean.h", "version.h"]) copyFileSync(join(prefix, "include", "lean", f), join(inc, "lean", f));
  writeFileSync(join(inc, "lean", "config.h"), "#pragma once\n#include <lean/version.h>\n#define LEAN_IS_STAGE0 0\n");
  writeFileSync(join(inc, "githash.h"), '#define LEAN_GITHASH "cradle-wasm"\n');
  copyFileSync(join(ASSETS, "uv.h"), join(inc, "uv.h"));
  return inc;
}

/** ランタイムの C++ を wasm の ar に。LEAN_EMSCRIPTEN はランタイムにだけ渡す（lean.h の 64bit の静的データの形を生成 C で変えないため）。 */
async function runtimeArchive(cache, src, inc) {
  const ar = join(cache, "libleanrt.a");
  if (existsSync(ar)) return ar;
  const objDir = join(cache, "rt-obj");
  mkdirSync(objDir, { recursive: true });
  const objects = await pool(RUNTIME_SOURCES, async (name) => {
    const o = join(objDir, `${name}.o`);
    await run("em++", ["-std=c++20", ...OPTIMIZE, ...TARGET, "-DLEAN_EMSCRIPTEN", `-I${src}`, `-I${inc}`, "-c", join(src, "runtime", `${name}.cpp`), "-o", o], { what: `ランタイムの ${name}.cpp` });
    return o;
  });
  const part = `${ar}.${process.pid}.a`;
  await run("emar", ["rcs", part, ...objects], { what: "emar" });
  renameSync(part, ar);
  return ar;
}

/** ランタイムが呼ぶ Lean 側の関数（@[export] された lean_mk_io_user_error など）。届く範囲の根に足す。 */
async function runtimeNeeds(ar) {
  const out = await run("emnm", ["--undefined-only", ar], { what: "emnm" });
  return [...new Set(out.split("\n").map(l => l.match(/^\s*U\s+(\S+)$/)?.[1]).filter(Boolean))];
}

/** ビルド済みのプロジェクトの C（依存パッケージも）。 */
function projectIrDirs() {
  const dirs = [join(cfg.lean.rootDir, ".lake", "build", "ir")];
  const packages = join(cfg.lean.rootDir, ".lake", "packages");
  if (existsSync(packages)) for (const p of readdirSync(packages)) dirs.push(join(packages, p, ".lake", "build", "ir"));
  return dirs.filter(existsSync);
}

/**
 * 入口のモジュールから import を辿ってプロジェクトの C を読む。.lake に残った古いモジュールの C は import から届かないので混ざらない。
 * 標準ライブラリのモジュールはここには無く、シンボルの索引で引く。
 */
function projectSources(entryModule) {
  const dirs = projectIrDirs();
  const pathOf = (m) => dirs.map(d => join(d, `${m.split(".").join("/")}.c`)).find(existsSync);
  const seen = new Set(), sources = [];
  const stack = [entryModule];
  while (stack.length) {
    const m = stack.pop();
    if (seen.has(m)) continue;
    seen.add(m);
    const file = pathOf(m);
    if (!file) { if (m === entryModule) fail(`${m} の C が無い。Runtime/Protocol.lean を敷いて lake build する（node <skills>/cradle-init/scripts/init.mjs --project ${cfg.project} --only ${cfg.lean.dir}/${cfg.lean.root}/Runtime/Protocol.lean、続けて --only ${cfg.lean.dir}/Main.lean --force）`); continue; }
    const text = readFileSync(file, "utf8");
    sources.push(text);
    const imports = text.match(/^\/\/ Imports: (.*)$/m)?.[1] ?? "";
    for (const im of imports.matchAll(/\bimport\s+(?:all\s+)?(\S+)/g)) stack.push(im[1]);
  }
  return sources;
}

/** 標準ライブラリのシンボル → モジュールの索引（配布の .a のシンボル表と .olean の並びから）。 */
function stdlibIndex(prefix) {
  const lib = join(prefix, "lib", "lean");
  const names = walk(lib, { ext: [".olean"], skip: [] }).map(p => p.slice(lib.length + 1, -".olean".length).split("/").join("."));
  const archives = ["libInit.a", "libStd.a", "libLean.a"].map(a => join(lib, a)).filter(existsSync).map(f => readFileSync(f));
  if (!archives.length) fail(`${lib} に libInit.a が無い`);
  return symbolIndex(archives, names);
}

/** 標準ライブラリの 1 モジュールの C。配布物に C は無いので、配布のソースから `lean -c` で作ってキャッシュに置く。 */
async function stdlibSource(cache, prefix, moduleName) {
  const dir = join(cache, "c");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${moduleName}.c`);
  if (!existsSync(file)) {
    const part = `${file}.${process.pid}`;
    const src = join(prefix, "src", "lean");
    await run(join(prefix, "bin", "lean"), ["-c", part, "-R", src, join(src, `${moduleName.split(".").join("/")}.lean`)], { env: { ...process.env, LEAN_PATH: join(prefix, "lib", "lean") }, what: `${moduleName} の C の生成` });
    renameSync(part, file);
  }
  return readFileSync(file, "utf8");
}

/** C 1 本を wasm のオブジェクトに。本文とフラグが同じならキャッシュを使う。 */
async function compileC(cache, inc, name, text) {
  const objDir = join(cache, "obj");
  mkdirSync(objDir, { recursive: true });
  const flags = ["-std=c11", ...OPTIMIZE, ...TARGET, `-I${inc}`];
  const key = sha256(`${flags.join(" ")}\n${text}`).slice(0, 32);
  const o = join(objDir, `${key}.o`);
  if (existsSync(o)) return o;
  const dir = join(cache, "pruned");
  mkdirSync(dir, { recursive: true });
  const c = join(dir, `${name}.${process.pid}.c`);
  writeFileSync(c, text);
  const part = `${o}.${process.pid}.o`;
  try { await run("emcc", [...flags, "-c", c, "-o", part], { what: `${name} のコンパイル` }); }
  finally { rmSync(c, { force: true }); }
  renameSync(part, o);
  return o;
}

/** lean.js を組み立てる。wasm は 1 枚に埋める（file:// でも開けるように — fetch も ES module も要らない）。 */
async function linkLeanJs(objects, ar, outFile) {
  const work = join(tmpdir(), `cradle-lean-js-${process.pid}`);
  mkdirSync(work, { recursive: true });
  try {
    const js = join(work, "lean.js");
    await run("em++", ["-O2", ...TARGET, ...objects, ar, "-o", js,
      "-sMODULARIZE", "-sEXPORT_NAME=createCradleLeanModule", "-sENVIRONMENT=web,worker,node", "-sSINGLE_FILE",
      "-sALLOW_MEMORY_GROWTH", "-sINITIAL_MEMORY=64MB", "-sSTACK_SIZE=16MB", "-sFILESYSTEM=0",
      "-sEXPORTED_FUNCTIONS=_cradle_init,_cradle_call,_free", "-sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToNewUTF8,lengthBytesUTF8",
      "-sERROR_ON_UNDEFINED_SYMBOLS=1"], { what: "wasm のリンク" });
    writeFileSync(outFile, `${readFileSync(js, "utf8").trimEnd()}\n${readFileSync(join(ASSETS, "footer.js"), "utf8")}`);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/** meta.js の中身: spec-query meta + 用語集（表示名の解決だけに使う）。 */
function metaJson() {
  const r = spawnSync(process.execPath, [cradleScript("spec-query.mjs"), "meta", "--build", "never"], { cwd: cfg.root, encoding: "utf8", maxBuffer: CHILD_OUTPUT_MAX, stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) fail(`spec-query meta が失敗した: ${r.error?.message ?? r.stderr}`);
  const meta = JSON.parse(r.stdout);
  meta.glossary = Object.fromEntries(glossaryEnglish(cfg));
  // 手元の絶対パスを画面に持ち込まない（lean.js と meta.js は配れる — 静的ホストに置いてよい）
  if (meta.lean) delete meta.lean.bin;
  return meta;
}

/** ネイティブの CLI と同じ応答を返すことを確かめるリクエスト: golden の init と flow、全シナリオの init と環境ごとの init、プロトコルエラー。 */
function probeRequests(meta) {
  const requests = ["not json", '{"cmd":"nope"}', '{"cmd":"nope"}\0garbage'];
  const dir = goldenDirOf(cfg);
  if (existsSync(dir)) for (const f of readableEntries(dir).filter(n => n.endsWith(".request.json")).sort()) {
    const s = readSidecar(dir, f.slice(0, -".request.json".length));
    for (const r of [s?.init, s?.flow]) if (r) requests.push(JSON.stringify(r));
  }
  for (const scenario of meta.scenarios ?? []) {
    requests.push(JSON.stringify({ cmd: "init", scenario }));
    if (meta.external) {
      requests.push(JSON.stringify({ cmd: "external", version: 1, action: "init", scenario }));
      for (const environment of meta.environments ?? []) requests.push(JSON.stringify({ cmd: "external", version: 1, action: "init", scenario, environment }));
    }
  }
  return [...new Set(requests)];
}

/** 作った lean.js を Node で読み、CLI と 1 バイトずつ突き合わせる。 */
async function selfTest(leanJs, requests) {
  // lean.js は globalThis に口を置く classic script。Node からは CommonJS として読める
  createRequire(import.meta.url)(leanJs);
  const lean = await globalThis.createCradleLean();
  const diffs = [];
  await pool(requests, async (r) => {
    const a = await lean(r);
    const b = await callLeanText(cfg, r);
    if (a !== b) diffs.push({ request: r, wasm: a, cli: b });
  });
  return diffs;
}

function writeMeta(meta) {
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, "meta.js"), `globalThis.CRADLE_META = ${JSON.stringify(meta)};\n`);
}

/** 束ねて lean.js を置く。CLI と違えば置かない。 */
async function buildLeanJs(meta) {
  const emcc = emccVersion();
  if (emcc !== TESTED_EMSCRIPTEN) console.log(`注意: Emscripten ${emcc}（確かめた版は ${TESTED_EMSCRIPTEN}）`);
  const { prefix, version, commit } = leanFacts();
  console.log(`Lean ${version} / Emscripten ${emcc}`);
  const cacheBase = process.env.CRADLE_WASM_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "cradle", "lean-wasm");
  // 同じ Lean・同じ Emscripten・同じ旗・同じ shim なら再利用する
  const cache = join(cacheBase, `${version}-${sha256([commit, emcc, TARGET, OPTIMIZE, RUNTIME_SOURCES, readFileSync(join(ASSETS, "uv.h"), "utf8")].join("\n")).slice(0, 16)}`);
  mkdirSync(cache, { recursive: true });

  const inc = includeDir(cache, prefix);
  const src = await runtimeSource(cache, commit);
  const rt = await runtimeArchive(cache, src, inc);
  const index = stdlibIndex(prefix);
  const closure = await reach({
    roots: ["cradle_handle", ...await runtimeNeeds(rt)],
    modules: projectSources(`${cfg.lean.root}.Runtime.Protocol`),
    loadModules: (names) => pool(names, (m) => stdlibSource(cache, prefix, m)),
    locate: (s) => index.get(s),
  });
  if (closure.unresolved.length) fail(`配布のライブラリにあるのに生成した C に無いシンボルがある（Lean の版を確かめる）: ${closure.unresolved.slice(0, 10).join(", ")}`);
  // 値を持たない initialize（作用だけ）はどこからも届かないので wasm では走らない。モデルの判断がそれに頼っていれば下の突き合わせで止まるが、理由が分かるよう知らせる
  for (const [name, mod] of closure.modules) {
    if (name !== cfg.lean.root && !name.startsWith(`${cfg.lean.root}.`)) continue;
    const effects = [...mod.inits.values()].flatMap(p => p.groups).filter(g => !g.var).length;
    if (effects) console.log(`  注意: ${name} の値を持たない initialize ${effects} 本は wasm では走らない`);
  }
  const pruned = [...closure.kept].filter(([, k]) => k.items.size || k.vars.size).map(([name, k]) => [name, prunedSource(closure.modules.get(name), k)]);
  const order = initSchedule(closure);
  pruned.push(["cradle_init", initSource(order)]);
  pruned.push(["cradle_entry", readFileSync(join(ASSETS, "entry.c"), "utf8")]);
  console.log(`  届く範囲: ${pruned.length - 2} モジュール / C ${(pruned.reduce((n, [, t]) => n + t.length, 0) / 1024 / 1024).toFixed(1)} MB / 起動時の初期化子 ${order.length} 本`);
  const objects = await pool(pruned, ([name, text]) => compileC(cache, inc, name, text));

  const work = join(tmpdir(), `cradle-lean-out-${process.pid}.cjs`);
  try {
    await linkLeanJs(objects, rt, work);
    // lean.js は配れる。手元の絶対パス（__FILE__ などから入る）が残っていれば置かない
    const leaked = localPathIn(readFileSync(work, "utf8"), [cfg.root, cacheBase, homedir()]);
    if (leaked) fail(`lean.js に手元の絶対パスが残っている（lean.js は置かない）: ${leaked}`);
    const requests = probeRequests(meta);
    const diffs = await selfTest(work, requests);
    if (diffs.length) {
      const d = diffs[0];
      fail(`wasm の応答が CLI と違う（${diffs.length} / ${requests.length} 件。lean.js は置かない）\n  リクエスト: ${d.request.slice(0, 400)}\n  wasm: ${d.wasm.slice(0, 400)}\n  CLI : ${d.cli.slice(0, 400)}`);
    }
    mkdirSync(publicDir, { recursive: true });
    const out = join(publicDir, "lean.js");
    copyFileSync(work, out);
    console.log(`  CLI と ${requests.length} 件のリクエストで一致`);
    console.log(`${cfg.lean.mockup}/public/lean.js（${(statSync(out).size / 1024 / 1024).toFixed(1)} MB）と meta.js を置いた。${cfg.lean.mockup}/public/index.html をブラウザで開く`);
  } finally { rmSync(work, { force: true }); }
}

async function main() {
  if (buildOpt === "always") lakeBuild(cfg);
  else if (!existsSync(cfg.lean.bin)) fail(`Lean CLI がありません: ${cfg.lean.bin}（cd ${cfg.lean.dir} && lake build）`);
  const meta = metaJson();
  if (opts["meta-only"]) {
    writeMeta(meta);
    console.log(`${cfg.lean.mockup}/public/meta.js を作り直した`);
    return;
  }
  await buildLeanJs(meta);
  writeMeta(meta);
}

main().catch(e => fail(e.message, e.exitCode ?? 1));
