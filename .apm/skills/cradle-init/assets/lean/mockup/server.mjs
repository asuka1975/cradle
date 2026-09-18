// lean/mockup/server.mjs — 仕様アニメーション用の無知なサーバー（Cradle 標準）。
//
// 役割は 4 つだけ。ここにドメインの判断を一切書かないこと:
//   1. public/ の静的配信
//   2. POST /api/lean   : body を Lean CLI の stdin へ素通しし、stdout をそのまま返す
//   3. POST /api/golden : {"name", "init": <init リクエスト>, "flow": <flow リクエスト>} を Lean に流し、
//                         応答をそのまま golden/<name>-init.json / <name>-flow.json に保存する。
//                         再生用にリクエストも {"version": 1, "init": …, "flow": …} の形で <name>.request.json に残す（golden-check が読む）。
//                         旧経路（cmd init / flow）でも外部能力の経路（cmd external）でも同じ。どちらかの応答のトップが ok でなければ
//                         （domainError / error / harnessError）何も書かず、その応答を添えて断る — golden は ok の応答だけ
//   4. GET  /api/meta   : シナリオ名・環境名・コマンドと内部入力の構成子・失敗語彙・入力の形・external の版（cradle spec-query meta の結果）
//                         + 用語集（英語候補 → 用語。表示名の解決だけに使う）
//
// 起動: node server.mjs   （事前に cd lean && lake build）
// CLI パス: 環境変数 CRADLE_LEAN_BIN、なければ ../.lake/build/bin/<lakefile の lean_exe 名>
import { createServer } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const LEAN_DIR = join(here, "..");
const exeName = (() => {
  try { return /\[\[lean_exe\]\]\s*\n\s*name\s*=\s*"([^"]+)"/.exec(readFileSync(join(LEAN_DIR, "lakefile.toml"), "utf8"))?.[1]; } catch { return null; }
})();
const BIN = process.env.CRADLE_LEAN_BIN ?? join(LEAN_DIR, ".lake", "build", "bin", exeName ?? "app");
const GOLDEN_DIR = join(LEAN_DIR, "golden");
const PORT = process.env.PORT ?? (() => {
  try { return JSON.parse(readFileSync(join(LEAN_DIR, "..", "cradle.json"), "utf8")).ports?.mockup ?? 8787; } catch { return 8787; }
})();
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function callLean(inputJson) {
  return new Promise((resolve, reject) => {
    const p = execFile(BIN, [], { maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
    p.stdin.write(inputJson);
    p.stdin.end();
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

/** cradle の spec-query で meta を取る。置き場は CRADLE_SPEC_QUERY > .claude/skills（Claude Code）> .agents/skills（Codex）。CLI が変わるまで結果を持つ。 */
let metaCache = null;
function meta() {
  const root = join(LEAN_DIR, "..");
  let key = "";
  try { key = String(statSync(BIN).mtimeMs); } catch {}
  if (metaCache && metaCache.key === key) return metaCache.value;
  const candidates = [
    process.env.CRADLE_SPEC_QUERY,
    ...[".claude", ".agents"].map(d => join(root, d, "skills", "cradle", "scripts", "spec-query.mjs")),
  ].filter(Boolean);
  let value = null;
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    try { value = JSON.parse(execFileSync(process.execPath, [c, "meta", "--build", "never"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CRADLE_PROJECT_DIR: root } })); }
    catch (e) { value = { error: String(e.message ?? e) }; }
    break;
  }
  if (!value) value = { error: `spec-query が見つかりません（${candidates.join(" / ")} のどれにも無い。cradle を apm install するか CRADLE_SPEC_QUERY で場所を指定する）` };
  value.glossary = glossary(root);
  metaCache = { key, value };
  return value;
}

/** ユビキタス言語の用語集（documents/ddd/ubiquitous-language.md）から 英語候補 → 用語 の対応を取る。画面の表示名に使うだけで、判断には使わない。 */
function glossary(root) {
  let ddd = "documents/ddd";
  try { ddd = JSON.parse(readFileSync(join(root, "cradle.json"), "utf8")).documents?.ddd ?? ddd; } catch {}
  const labels = {};
  try {
    for (const line of readFileSync(join(root, ddd, "ubiquitous-language.md"), "utf8").split("\n")) {
      const cells = line.split("|").map(c => c.trim());
      if (cells.length < 4 || !cells[1] || cells[1] === "用語" || /^-+$/.test(cells[1])) continue;
      for (const e of cells[2].split(/[\/、,]/).map(x => x.trim()).filter(Boolean)) labels[e.replace(/\s+/g, "").toLowerCase()] = cells[1];
    }
  } catch {}
  return labels;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/lean") {
      const out = await callLean(await readBody(req));
      res.writeHead(200, { "content-type": "application/json" }).end(out);
      return;
    }
    if (req.method === "GET" && req.url === "/api/meta") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(meta()));
      return;
    }
    if (req.method === "POST" && req.url === "/api/golden") {
      const { name, init, flow } = JSON.parse(await readBody(req));
      const safe = String(name || "session").replace(/[^\w.-]/g, "_");
      // 先に 2 本とも流し、どちらかのトップが ok でなければ何も書かない（golden は ok の応答そのもの）
      const responses = [];
      for (const [kind, request] of [["init", init], ["flow", flow]]) {
        if (!request) { res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: `${kind} リクエストが無い` })); return; }
        const parsed = JSON.parse(await callLean(JSON.stringify(request)));
        if (!parsed || typeof parsed !== "object" || !("ok" in parsed)) {
          res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: `${kind} の応答が ok ではないので保存しない`, kind, response: parsed }));
          return;
        }
        responses.push([kind, parsed]);
      }
      await mkdir(GOLDEN_DIR, { recursive: true });
      const saved = [];
      for (const [kind, parsed] of responses) {
        const file = join(GOLDEN_DIR, `${safe}-${kind}.json`);
        await writeFile(file, JSON.stringify(parsed, null, 2) + "\n");
        saved.push(file);
      }
      const reqFile = join(GOLDEN_DIR, `${safe}.request.json`);
      await writeFile(reqFile, JSON.stringify({ version: 1, init, flow }, null, 2) + "\n");
      saved.push(reqFile);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ saved }));
      return;
    }
    const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const file = join(here, "public", path.replace(/\.\./g, ""));
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e.message ?? e) }));
  }
});

server.listen(PORT, () => {
  console.log(`spec animation: http://localhost:${PORT}  (bin: ${BIN})`);
});
