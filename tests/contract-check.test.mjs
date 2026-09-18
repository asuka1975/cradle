import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const contractCheck = fileURLToPath(new URL("../.apm/skills/api-contract/scripts/contract-check.mjs", import.meta.url));

// spec-query meta の代わりに渡す meta: コマンド 2 つ・観測 2 つ・画面の口 2 つ
const meta = {
  project: "Example",
  commands: ["bookVisit", "cancelVisit"],
  observations: ["paymentConfirmed", "paymentExpired"],
  views: { outlets: ["visits", "employees"] },
};

// openapi.yaml の paths を組む。op は { method, path, id, kind, model }（kind・model は省けば書かない）
function paths(ops) {
  return ops.map(o => [
    `  ${o.path}:`,
    `    ${o.method}:`,
    `      operationId: ${o.id}`,
    ...(o.kind ? [`      x-cradle-kind: ${o.kind}`] : []),
    ...(o.model ? [`      x-cradle-model: ${o.model}`] : []),
    "      responses:",
    `        "${o.method === "get" ? "200" : "204"}":`,
    "          description: ok",
  ].join("\n")).join("\n");
}

const get = (path, id) => ({ method: "get", path, id });
const command = (path, id, ctor, over = {}) => ({ method: "post", path, id, kind: "command", model: `Example.Runtime.Command.${ctor}`, ...over });
const observation = (path, id, ctor, over = {}) => ({ method: "post", path, id, kind: "observation", model: `Example.Runtime.Observation.${ctor}`, ...over });

// 一時プロジェクト: cradle.json と openapi.yaml だけ。契約検査を --meta @file --json で走らせて結果を返す
function run(t, ops, { config = {}, metaOverride = meta } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cradle-contract-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "cradle.json"), JSON.stringify({ project: "Example", ...config }));
  mkdirSync(join(root, "documents/codebase"), { recursive: true });
  writeFileSync(join(root, "documents/codebase/openapi.yaml"), `openapi: 3.1.0\ninfo:\n  title: t\n  version: 0.0.1\npaths:\n${paths(ops)}\n`);
  writeFileSync(join(root, "meta.json"), JSON.stringify(metaOverride));
  const env = { ...process.env };
  for (const key of ["CRADLE_PROJECT_DIR", "CRADLE_CONFIG", "CLAUDE_PROJECT_DIR"]) delete env[key];
  const r = spawnSync(process.execPath, [contractCheck, "--meta", "@meta.json", "--json"], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
  assert.ok(r.stdout.trim(), r.stderr);
  return { status: r.status, result: JSON.parse(r.stdout) };
}

const covered = [
  get("/api/visits", "listVisits"),
  get("/api/employees", "listEmployees"),
  command("/api/visits", "bookVisit", "bookVisit"),
  command("/api/visits/cancel", "cancelVisit", "cancelVisit"),
  observation("/api/payments/confirmed", "receivePaymentConfirmed", "paymentConfirmed"),
];

test("コマンドがすべて kind と model 付きの操作で覆われていれば OK。操作の無い観測は worker 受信として報告する", (t) => {
  const { status, result } = run(t, covered);
  assert.equal(status, 0, JSON.stringify(result));
  assert.equal(result.ok, true);
  assert.deepEqual(result.undeclaredOps, []);
  assert.deepEqual(result.opsWithUnknownModel, []);
  assert.deepEqual(result.commandsWithoutOp, []);
  assert.deepEqual(result.commandsWithManyOps, []);
  assert.deepEqual(result.observationsWithManyOps, []);
  assert.deepEqual(result.outletsWithoutGet, []);
  assert.deepEqual(result.observations, [{ name: "paymentConfirmed", reception: "public" }, { name: "paymentExpired", reception: "worker" }]);
});

test("x-cradle-kind の無い GET 以外の操作は黙って除外せず undeclaredOps で NG", (t) => {
  const { status, result } = run(t, [...covered, { method: "post", path: "/api/visits/bulk", id: "bulkBookVisit" }]);
  assert.equal(status, 1);
  assert.equal(result.ok, false);
  assert.deepEqual(result.undeclaredOps.map(o => o.operationId), ["bulkBookVisit"]);
  // model だけ無いのも宣言不足
  const modelless = run(t, [...covered, { method: "post", path: "/api/visits/bulk", id: "bulkBookVisit", kind: "command" }]);
  assert.deepEqual(modelless.result.undeclaredOps.map(o => o.operationId), ["bulkBookVisit"]);
});

test("x-cradle-model がモデルに無い構成子を指す・kind と食い違う・ルートが違うと opsWithUnknownModel で NG", (t) => {
  const { status, result } = run(t, [
    ...covered,
    command("/api/visits/move", "moveVisit", "moveVisit"),
    observation("/api/payments/expired", "receivePaymentExpired", "paymentExpired", { model: "Example.Runtime.Command.paymentExpired" }),
    observation("/api/payments/refunded", "receivePaymentRefunded", "paymentConfirmed", { model: "Other.Runtime.Observation.paymentConfirmed" }),
  ]);
  assert.equal(status, 1);
  assert.deepEqual(result.opsWithUnknownModel.map(o => o.operationId), ["moveVisit", "receivePaymentExpired", "receivePaymentRefunded"]);
  assert.match(result.opsWithUnknownModel[0].reason, /moveVisit/);
  assert.match(result.opsWithUnknownModel[1].reason, /食い違う/);
  assert.match(result.opsWithUnknownModel[2].reason, /ルート/);
  // 解決できなかった操作は観測の受信にも数えない
  assert.deepEqual(result.observations, [{ name: "paymentConfirmed", reception: "public" }, { name: "paymentExpired", reception: "worker" }]);
});

test("パスにコマンド名を含んでいても observation と宣言した操作はそのコマンドの操作に数えない", (t) => {
  const ops = covered.filter(o => o.id !== "cancelVisit");
  ops.push(observation("/api/visits/cancelVisit", "cancelVisit", "paymentExpired"));
  const { status, result } = run(t, ops);
  assert.equal(status, 1);
  assert.deepEqual(result.commandsWithoutOp, ["cancelVisit"]);
  assert.deepEqual(result.opsWithUnknownModel, []);
  assert.deepEqual(result.observations, [{ name: "paymentConfirmed", reception: "public" }, { name: "paymentExpired", reception: "public" }]);
});

test("同じ構成子を指す操作が複数あれば NG（コマンドも観測も）", (t) => {
  const { status, result } = run(t, [
    ...covered,
    command("/api/visits/again", "bookVisitAgain", "bookVisit"),
    observation("/api/payments/confirmed-again", "receivePaymentConfirmedAgain", "paymentConfirmed"),
  ]);
  assert.equal(status, 1);
  assert.deepEqual(result.commandsWithManyOps.map(c => c.name), ["bookVisit"]);
  assert.deepEqual(result.commandsWithManyOps[0].ops, ["POST /api/visits (bookVisit)", "POST /api/visits/again (bookVisitAgain)"]);
  assert.deepEqual(result.observationsWithManyOps.map(c => c.name), ["paymentConfirmed"]);
});

test("GET の無い画面の口は NG。api.outletsWithoutEndpoint に挙げた口は端点を要らない", (t) => {
  const ops = covered.filter(o => o.id !== "listEmployees");
  const ng = run(t, ops);
  assert.equal(ng.status, 1);
  assert.deepEqual(ng.result.outletsWithoutGet, ["employees"]);
  const ok = run(t, ops, { config: { api: { outletsWithoutEndpoint: ["employees"] } } });
  assert.equal(ok.status, 0, JSON.stringify(ok.result));
  assert.deepEqual(ok.result.outletsWithoutGet, []);
  assert.equal(ok.result.outlets, 1);
});
