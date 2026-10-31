#!/usr/bin/env node
// golden-check — golden（モデルが吐いた入出力例）を CLI で再生し、いまのモデルの応答と突き合わせる。
// モデルを変えたとき「変えるつもりのなかった流れ」が変わっていないかを検知する回帰検査。
//
//   golden-check [--name N]... [--manifest file] [--update] [--build auto|always|never] [--json]
//
// golden/ の規約: <name>-init.json = init の応答そのもの、<name>-flow.json = flow の応答そのもの。
// 再生に要るリクエストは <name>.request.json（sidecar: {"version":1,"init":{…},"flow":{…}}）から読む。version が 1 でなければ error。
// version の無い旧形式の sidecar は旧経路（cmd init / flow）の golden にだけ許す。
// 旧経路の golden に sidecar が無ければ --manifest（{"<name>": {"scenario":…,"viewer":…,"today":…,"actor":…}}）で補い、
// flow の commands は trace から復元する。読めない・JSON でない・トップか項目がオブジェクトでない manifest は 1 行で止める。
// 外部能力の経路（cmd external）で採った golden は sidecar が必須 — 環境（script）と入力列（command | observation と指名した障害）は
// 応答から復元できないので、無ければ error（モックアップで採り直す）。sidecar が無くても応答の形（init の env・trace の env / result）で
// external と分かる golden は同じ扱いで、manifest からの復元も CLI の呼び出しもしない。
//
// 検査は 3 種。init / flow は応答そのものの一致。chain（external だけ）は flow の入力列を init + step の連鎖で打ち直し、
// 手ごとの応答（result / state / views / env / interactions / domainError / faultContract）と最後の env が再生した flow と一致すること
// — flow は連続する step の定義そのものなので、ずれれば実行器の不整合。
// 応答に現れる外部能力の往復（init の env の script・trace の interactions の port / operation）は Lean の Port の一覧
// （Application/Port/<Port>/<操作>.lean、Domain/Port も同じ）に要り、無ければ error。
// 形の違う golden（ok がオブジェクトでない・ok.trace / ok.env.script / 手の interactions が配列でない・手と往復がオブジェクトでない）と sidecar（init / flow のリクエストが無い・オブジェクトでない・
// flow.inputs が配列でない・手がオブジェクトでない）はファイル名つきの error にして再生しない。
// --update が書くのは init / flow の応答だけで、トップが ok でない応答（error / harnessError）は書かない。chain は書くものを持たない。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfigOrFail, readableEntries, buildMode, callLean, parseArgs, blankArg, diffJson, fail, readSidecar, readManifest, isExternalGolden, readGoldenTrace, traceInputOf, ports, hasPortOperation, SIDECAR_VERSION, goldenDirOf, goldenRowLines } from "./lib.mjs";

const opts = parseArgs(process.argv.slice(2), { update: "bool", json: "bool", name: "list" });
if (opts.name?.some(n => n === true || n === "")) fail("--name には golden の名前が要ります（--name N を繰り返せば複数）");
// 値の無い --manifest を true のまま readFileSync に渡さない（空の値を manifest 無しとして黙って読まない）
if (blankArg(opts.manifest)) fail("--manifest には manifest のファイル（JSON）のパスが要ります");
const cfg = loadConfigOrFail();
const build = buildMode(opts.build);
const goldenDir = goldenDirOf(cfg);
if (!existsSync(goldenDir)) fail(`golden ディレクトリがありません: ${goldenDir}`);

// 読めない・形の違う manifest は読んだところでパスと理由の 1 行で止める（ENOENT や TypeError のスタックトレースにしない）
let manifest = {};
if (opts.manifest) { try { manifest = readManifest(opts.manifest); } catch (e) { fail(e.message); } }
const names = [...new Set(readableEntries(goldenDir).filter(f => /-(init|flow)\.json$/.test(f)).map(f => f.replace(/-(init|flow)\.json$/, "")))].sort();
// --name の順に、同じ名前は 1 度だけ
const wanted = opts.name ? [...new Set(opts.name)] : names;
const portList = ports(cfg);

/** 旧経路の golden だけ: manifest の項目と保存した flow の応答（flow）の trace から init / flow のリクエストを復元する。
    flow は検査のループで読んだもの — ok の応答の trace はそこで形を確かめてあり、ok でない応答・無いファイルは 0 手。 */
function manifestRequests(name, flow) {
  // 自前の鍵だけ: constructor・toString という名前の golden を Object.prototype の値で manifest の項目に数えない
  if (!Object.hasOwn(manifest, name)) return null;
  const m = manifest[name];
  const base = { scenario: m.scenario ?? "basic" };
  if (m.viewer !== undefined) base.viewer = m.viewer;
  if (m.today !== undefined) base.today = m.today;
  if (m.actor !== undefined) base.actor = m.actor;
  const commands = (flow?.ok?.trace ?? []).map(t => t.actor ? { actor: t.actor, command: t.command } : t.command);
  return { init: { cmd: "init", ...base }, flow: { cmd: "flow", ...base, commands } };
}

const isOk = (res) => !!res && typeof res === "object" && "ok" in res;
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** 保存した ok の応答に現れる外部能力の往復（init は env の script、flow は trace の interactions）。ok がオブジェクトでない・
    init の ok.env.script と flow の手の interactions が配列でない・その要素がオブジェクトでない・要素の port / operation が文字列でなければファイル名を添えて投げ
    （欠けた欄を `undefined.undefined が Port に無い` と言わず、自前の toString を持つ欄で "<port>.<operation>" の文字列化が投げず、null を黙って落とさない）、
    flow の trace の形は readGoldenTrace が status の事実と同じ理由で投げる。
    CLI の応答（再生・連鎖）は isOk だけで判定する — 形を締めるのは保存した golden だけ。 */
function storedPortCalls(kind, name, top) {
  const file = `${name}-${kind}.json`;
  if (!isObject(top.ok)) throw new Error(`${file} の ok がオブジェクトではない`);
  const calls = (list, where) => {
    if (!Array.isArray(list)) throw new Error(`${file} の ${where} が配列ではない`);
    const bad = list.findIndex(c => !isObject(c));
    if (bad >= 0) throw new Error(`${file} の ${where} の ${bad + 1} 番目がオブジェクトではない`);
    const unnamed = list.findIndex(c => typeof c.port !== "string" || typeof c.operation !== "string");
    if (unnamed >= 0) throw new Error(`${file} の ${where} の ${unnamed + 1} 番目の port / operation が文字列ではない`);
    return list;
  };
  if (kind === "flow") return readGoldenTrace(goldenDir, file).flatMap((t, i) => calls(t.interactions ?? [], `ok.trace の ${i + 1} 手目の interactions`));
  return calls(top.ok.env?.script ?? [], "ok.env.script");
}

/** 外部能力の往復のうち Lean の Port に無いもの（"<Port>.<operation>"、重複無し）。 */
const unknownPortCalls = (calls) => [...new Set(calls.filter(c => !hasPortOperation(portList, c.port, c.operation)).map(c => `${c.port}.${c.operation}`))];

const CHAIN_KEYS = ["result", "state", "views", "env", "interactions", "domainError", "faultContract"];
const pickFields = (src, keys) => Object.fromEntries(keys.filter(k => src?.[k] !== undefined).map(k => [k, src[k]]));

/** changed の行。i は最初に食い違った手（0 始まり。手でなければ undefined）、input はその手の入力（traceInputOf の結果か null）—
    入力の出どころは呼び手ごとに違う（chain は sidecar の inputs、init / flow は保存した golden の trace）。 */
function changedEntry(name, kind, diffs, i, input) {
  return { name, kind, status: "changed", firstDivergence: diffs[0].path, step: i === undefined ? undefined : i + 1,
    command: input?.name, inputKind: input?.name !== undefined ? input.kind : undefined, diffs: diffs.slice(0, 12) };
}

/** external の flow を init + step の連鎖で打ち直し、再生した flow の応答（trace の各要素の射影と最後の env）と突き合わせる。
    init は sidecar の flow のリクエストの欄（scenario・環境・actor・viewer・today）から組む。
    inputs は呼び手が形を確かめた sidecar の入力列（配列で、手はオブジェクト）。
    CLI が落ちた・JSON でない応答を返したときも error の行で返す（投げると検査済みの golden の行も出ないまま止まる）。数えるのは呼び手。 */
async function chainReplay(name, flowReq, inputs, flowRes) {
  const trace = flowRes.ok.trace ?? [];
  const changed = (diffs, i) => changedEntry(name, "chain", diffs, i, i === undefined ? null : traceInputOf(inputs[i]));
  const chainError = (reason) => ({ name, kind: "chain", status: "error", reason });
  const common = pickFields(flowReq, ["actor", "viewer", "today"]);
  let init;
  try { init = await callLean(cfg, { cmd: "external", version: SIDECAR_VERSION, action: "init", ...pickFields(flowReq, ["scenario", "environment", "env"]), ...common }, { build }); }
  catch (e) { return chainError(e.message); }
  if (!isOk(init)) return chainError(`連鎖の init の応答のトップが ok ではない: ${JSON.stringify(init).slice(0, 300)}`);
  if (trace.length !== inputs.length) return changed([{ path: "/ok/trace", expected: `length ${inputs.length}（sidecar の inputs）`, actual: `length ${trace.length}` }]);
  let state = init.ok.state, env = init.ok.env;
  for (let i = 0; i < inputs.length; i++) {
    let res;
    try { res = await callLean(cfg, { cmd: "external", version: SIDECAR_VERSION, action: "step", state, env, input: inputs[i], ...common }, { build }); }
    catch (e) { return chainError(e.message); }
    if (!isOk(res)) return changed([{ path: `/ok/trace/${i}`, expected: "ok", actual: res }], i);
    const diffs = diffJson(pickFields(trace[i], CHAIN_KEYS), pickFields(res.ok, CHAIN_KEYS), `/ok/trace/${i}`);
    if (diffs.length) return changed(diffs, i);
    state = res.ok.state; env = res.ok.env;
  }
  const diffs = diffJson(flowRes.ok.env, env, "/ok/env");
  return diffs.length ? changed(diffs) : { name, kind: "chain", status: "ok" };
}

const report = [];
let failed = 0;
const error = (name, reason, kind) => { report.push({ name, ...(kind ? { kind } : {}), status: "error", reason }); failed++; };
for (const name of wanted) {
  let stop = false;
  const stored = {};
  for (const kind of ["init", "flow"]) {
    const file = join(goldenDir, `${name}-${kind}.json`);
    if (!existsSync(file)) { error(name, `${name}-${kind}.json が無い（golden は init / flow の 2 本 1 組）`, kind); continue; }
    let top; try { top = JSON.parse(readFileSync(file, "utf8")); } catch (e) { error(name, `JSON として読めない: ${e.message}`, kind); stop = true; continue; }
    if (!isOk(top)) error(name, "トップレベルが {\"ok\": …} ではない（CLI の応答そのものを置く）", kind);
    else {
      // 形の違う golden（storedPortCalls が投げる）はファイル名つきの error にして再生しない — 投げると stack trace だけで、残りの golden の行も出ない。
      // この後の障害契約の照合と manifest の復元は、ok がオブジェクトの応答だけを読む
      let calls;
      try { calls = storedPortCalls(kind, name, top); } catch (e) { error(name, e.message, kind); stop = true; continue; }
      const unknown = unknownPortCalls(calls);
      if (unknown.length) { error(name, `外部能力の往復 ${unknown.join(", ")} が Lean の Port（Application/Port/<Port>/<操作>.lean）に無い`, kind); stop = true; }
    }
    stored[kind] = top;
  }
  if (stop) continue;
  let sidecar, external;
  try { sidecar = readSidecar(goldenDir, name); external = isExternalGolden(goldenDir, name); }
  catch (e) { error(name, e.message); continue; }
  let reqs, inputs;
  if (external) {
    if (!sidecar) { error(name, `外部能力を使う golden は ${name}.request.json（版・環境・入力列）が無いと再生できない — モックアップで採り直す`); continue; }
    reqs = sidecar;
    // 入力列は障害契約の照合と連鎖が読む。形の違う sidecar（配列でない・手がオブジェクトでない）はファイル名つきの error にして再生しない — 投げると stack trace だけで、残りの golden の行も出ない
    inputs = reqs.flow?.inputs ?? [];
    if (!Array.isArray(inputs)) { error(name, `${name}.request.json の flow.inputs が配列ではない`); continue; }
    const bad = inputs.findIndex(x => !isObject(x));
    if (bad >= 0) { error(name, `${name}.request.json の flow.inputs の ${bad + 1} 手目がオブジェクトではない`); continue; }
    // 障害契約を指名した手は、保存した応答でもその契約で止まっている（そうでなければ sidecar と応答が別の採取のもの）
    if (isOk(stored.flow)) {
      const trace = stored.flow.ok.trace ?? [];
      const mismatch = inputs.map((input, i) => ({ step: i + 1, fault: input?.fault, result: trace[i]?.result })).find(x => typeof x.fault === "string" && x.result !== "fault");
      if (mismatch) { error(name, `手 #${mismatch.step} は障害契約 ${mismatch.fault} を指名しているのに、保存した flow の応答の result が fault ではない（${JSON.stringify(mismatch.result)}）— sidecar と応答が食い違っている。モックアップで採り直す`, "flow"); continue; }
    }
  } else {
    reqs = sidecar ?? manifestRequests(name, stored.flow);
    if (!reqs) { report.push({ name, status: "skipped", reason: `${name}.request.json が無い（再生できない golden）— モックアップで採り直すか --manifest で補う` }); continue; }
  }
  const replayed = {};
  for (const kind of ["init", "flow"]) {
    const file = join(goldenDir, `${name}-${kind}.json`);
    if (!existsSync(file)) continue;
    // 片方のリクエストが無い・オブジェクトでない sidecar は、その片方を黙って飛ばさず error にする — 飛ばすと保存した応答を見ないまま通る
    // （callLean は文字列を JSON の文としてそのまま渡す）。manifest からの復元は 2 本とも組む
    if (!isObject(reqs[kind])) { error(name, reqs[kind] == null ? `${name}.request.json に ${kind} のリクエストが無い` : `${name}.request.json の ${kind} がオブジェクトではない`, kind); continue; }
    const expected = stored[kind];
    let actual;
    try { actual = await callLean(cfg, reqs[kind], { build }); }
    catch (e) { error(name, e.message, kind); continue; }
    if (!isOk(actual)) { error(name, `CLI の応答のトップが ok ではない: ${JSON.stringify(actual).slice(0, 300)}（golden は ok の応答だけ — --update でも書かない）`, kind); continue; }
    replayed[kind] = actual;
    const diffs = diffJson(expected, actual);
    if (!diffs.length) { report.push({ name, kind, status: "ok" }); continue; }
    if (opts.update) { writeFileSync(file, JSON.stringify(actual, null, 2) + "\n"); report.push({ name, kind, status: "updated", diffs: diffs.length }); continue; }
    failed++;
    const step = diffs[0].path.match(/^\/ok\/trace\/(\d+)/);
    const i = step ? Number(step[1]) : undefined;
    // 最初に食い違った手の入力: command の名前か observation の名前（report の鍵は command のまま。inputKind でどちらかを示す）
    report.push(changedEntry(name, kind, diffs, i, step ? traceInputOf(expected.ok?.trace?.[i]) : null));
  }
  // 連鎖は再生した flow（保存した golden ではない）と比べる — init / flow の応答が ok で揃ったときだけ
  if (external && replayed.init && replayed.flow) {
    const r = await chainReplay(name, reqs.flow, inputs, replayed.flow);
    report.push(r);
    if (r.status !== "ok") failed++;
  }
}

if (opts.json) console.log(JSON.stringify({ failed, report }, null, 2));
else {
  for (const r of report) for (const line of goldenRowLines(r)) console.log(line);
  console.log(`\n${report.filter(r => r.status === "ok").length} ok, ${failed} changed/error, ${report.filter(r => r.status === "skipped").length} skipped`);
  if (failed) console.log("変更が意図したものなら --update で golden を更新し、golden の差分を変更理由とともにコミットすること。意図していない流れが変わっていたら、それがモデル変更の意図しない影響。chain の食い違いは実行器（flow と step）の不整合で、--update では直らない。");
}
// process.exit はパイプにまだ書いていない stdout を捨てる（--json が 64KB 前後で切れる）。終了コードだけを置いて書き切らせる
process.exitCode = failed ? 1 : 0;
