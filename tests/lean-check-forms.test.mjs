import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const leanCheck = fileURLToPath(new URL("../.apm/skills/cradle/scripts/lean-check.mjs", import.meta.url));

// 一時プロジェクト: UseCase ディレクトリの形と Runtime の配線だけを持つ Lean モデル（lake build はしない）。鍵 Main.lean だけは lean/ 直下（CLI）
function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "cradle-lean-check-forms-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "cradle.json"), JSON.stringify({ project: "Example" }));
  for (const [rel, text] of Object.entries(files)) {
    const f = rel === "Main.lean" ? join(root, "lean", rel) : join(root, "lean/Example", rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, text);
  }
  const env = { ...process.env };
  for (const key of ["CRADLE_PROJECT_DIR", "CRADLE_CONFIG", "CLAUDE_PROJECT_DIR"]) delete env[key];
  const r = spawnSync(process.execPath, [leanCheck, "--json"], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
  return JSON.parse(r.stdout).findings.filter(f => ["usecase", "wiring", "cqrs"].includes(f.rule));
}

const observationUseCase = (extra = "") => `import Example.Domain.Entity.Attempt
namespace Example.Application.ConfirmUseCase
def validate (o : Observation) (before : State) : Except DomainError Attempt := sorry
def act (o : Observation) (before : State) (a : Attempt) : State := sorry
def execute (o : Observation) (before : State) : Except DomainError State := (validate o before).map (act o before)
${extra}
end Example.Application.ConfirmUseCase
`;
const dispatchUseCase = `namespace Example.Application.DispatchUseCase
def validate (o : Observation) (before : State) : Except DomainError Attempt := sorry
def mkRequest (o : Observation) (before : State) (a : Attempt) : Authorize.Request := sorry
def request (o : Observation) (before : State) : Except DomainError Authorize.Request := (validate o before).map (mkRequest o before)
def apply (outcome : Authorize.Outcome) (o : Observation) (before : State) (a : Attempt) : Except DomainError State := sorry
def execute (outcome : Authorize.Outcome) (o : Observation) (before : State) : Except DomainError State := (validate o before) >>= apply outcome o before
end Example.Application.DispatchUseCase
`;
const runtime = {
  "Runtime/Command.lean": "namespace Example.Runtime\ninductive Command where\n  | start (c : StartUseCase.Command)\nderiving Repr\nend Example.Runtime\n",
  "Runtime/Observation.lean": "namespace Example.Runtime\ninductive Observation where\n  | confirm (o : ConfirmUseCase.Observation)\n  | dispatch (o : DispatchUseCase.Observation)\nderiving Repr\nend Example.Runtime\n",
  "Runtime/Json.lean": 'instance : FromJson Command where\n  fromJson? j := match (j.getObjVal? "start").toOption with | some p => (fromJson? p).map Command.start | none => .error "unknown command"\ninstance : FromJson Observation where\n  fromJson? j := match (j.getObjVal? "confirm").toOption, (j.getObjVal? "dispatch").toOption with | some p, _ => (fromJson? p).map Observation.confirm | _, some p => (fromJson? p).map Observation.dispatch | _, _ => .error "unknown observation"\n',
  "Runtime/Machine.lean": "def Snapshot.applyCommand (cmd : Command) (s : Snapshot) : Except DomainError Snapshot :=\n  match cmd with\n  | .start c => sorry\n\ndef Snapshot.applyObservation (obs : Observation) (s : Snapshot) : Except DomainError Snapshot :=\n  match obs with\n  | .confirm o => sorry\n  | .dispatch o => sorry\n",
};
const wellFormed = {
  "Application/UseCase/StartUseCase/Command.lean": "structure Command where\n  visit : Nat\n",
  "Application/UseCase/StartUseCase/UseCase.lean": "def validate (actor : ActorContext UserId) (c : Command) (before : State) : Except DomainError Unit := sorry\ndef act (c : Command) (before : State) (r : Unit) : State := sorry\ndef execute (actor : ActorContext UserId) (c : Command) (before : State) : Except DomainError State := (validate actor c before).map (act c before)\n",
  "Application/UseCase/ConfirmUseCase/Observation.lean": "structure Observation where\n  attempt : Nat\n",
  "Application/UseCase/ConfirmUseCase/UseCase.lean": observationUseCase(),
  "Application/UseCase/DispatchUseCase/Observation.lean": "structure Observation where\n  attempt : Nat\n",
  "Application/UseCase/DispatchUseCase/UseCase.lean": dispatchUseCase,
  ...runtime,
};

test("内部入力の固定形（Observation.lean + UseCase.lean）は更新系と同じ固定名で通り、Entity を import してよい", (t) => {
  assert.deepEqual(fixture(t, wellFormed), []);
});

test("Command と Observation の同居、名義を受ける内部入力、request があるのに mkRequest / apply が無い形は error", (t) => {
  const findings = fixture(t, {
    ...wellFormed,
    "Application/UseCase/ConfirmUseCase/Command.lean": "structure Command where\n  x : Nat\n",
    "Application/UseCase/DispatchUseCase/UseCase.lean": dispatchUseCase.replace(/def mkRequest[^\n]*\n/, "").replace("def execute (outcome", "def execute (actor : ActorContext UserId) (outcome"),
  });
  const messages = findings.map(f => f.message);
  assert.ok(messages.some(m => /どれか 1 つだけ/.test(m)), messages.join(" / "));
  assert.ok(messages.some(m => /名義（ActorContext）を受けている/.test(m)), messages.join(" / "));
  assert.ok(messages.some(m => /固定名 mkRequest が無い/.test(m)), messages.join(" / "));
});

test("Runtime/Observation.lean の構成子は Json.lean と applyObservation の腕の両方に要り、Observation 形があるのに合併型が無ければ error", (t) => {
  const missingArm = fixture(t, { ...wellFormed, "Runtime/Machine.lean": runtime["Runtime/Machine.lean"].replace("  | .dispatch o => sorry\n", "") });
  assert.ok(missingArm.some(f => f.rule === "wiring" && /構成子 dispatch の腕が Machine.lean の applyObservation に無い/.test(f.message)), JSON.stringify(missingArm));
  // Command の腕に同名の構成子があっても applyObservation の腕とは数えない
  const wrongArm = fixture(t, { ...wellFormed, "Runtime/Command.lean": runtime["Runtime/Command.lean"].replace("| start (c", "| dispatch (c"), "Runtime/Machine.lean": runtime["Runtime/Machine.lean"].replace("| .start c => sorry", "| .dispatch c => sorry").replace("  | .dispatch o => sorry\n", "") });
  assert.ok(wrongArm.some(f => /構成子 dispatch の腕が Machine.lean の applyObservation に無い/.test(f.message)), JSON.stringify(wrongArm));
  const missingJson = fixture(t, { ...wellFormed, "Runtime/Json.lean": runtime["Runtime/Json.lean"].replace('"confirm"', '"confirmed"') });
  assert.ok(missingJson.some(f => f.rule === "wiring" && /構成子 confirm のワイヤ形式/.test(f.message)), JSON.stringify(missingJson));
  const noUnion = { ...wellFormed };
  delete noUnion["Runtime/Observation.lean"];
  const missingUnion = fixture(t, noUnion);
  assert.ok(missingUnion.some(f => f.rule === "wiring" && /Runtime\/Observation.lean/.test(f.message)), JSON.stringify(missingUnion));
});

test("Observation.lean が名義を運ぶ形と、Runtime/Command.lean に内部入力を混ぜる形は error", (t) => {
  const findings = fixture(t, {
    ...wellFormed,
    "Application/UseCase/ConfirmUseCase/Observation.lean": "structure Observation where\n  attempt : Nat\n  by : ActorContext UserId\n",
    "Runtime/Command.lean": runtime["Runtime/Command.lean"].replace("deriving Repr", "  | confirm (o : ConfirmUseCase.Observation)\nderiving Repr"),
  });
  const messages = findings.map(f => f.message);
  assert.ok(messages.some(m => /名義（ActorContext）を運んでいる/.test(m)), messages.join(" / "));
  assert.ok(messages.some(m => /構成子 confirm が内部入力（Observation）を運んでいる/.test(m)), messages.join(" / "));
});

// 外部能力を持つ Lean モデルの配線（Lobby の形）: 合併型 2 つ、Port、環境、CLI。腕は構成子ごとに withFault の中で viaPort か direct
const lobbyMachine = `namespace Example.Runtime

/-- 利用者の操作のルーティング表。Port を使う腕は viaPort、使わない腕は direct。 -/
def Snapshot.applyCommand (_today : Date) (actor : Actor) (cmd : Command) (fault : Option String) (s : Snapshot)
    (env : Environment) (_h : s.check = true) : StepResult :=
  match cmd with
  | .bookVisit c =>
    withFault fault [("directoryUnavailable", BookVisitUseCase.directoryUnavailable actor.context c s.visitState)] fun f =>
      viaPort env (BookVisitUseCase.request actor.context c s.visitState) (BookVisitUseCase.apply · actor.context c s.visitState) f
  | .leave c =>
    withFault fault [] fun f =>
      direct env ((LeaveUseCase.execute actor.context c s.visits).map fun v => { s with visits := v }) f

/-- 内部入力のルーティング表。 -/
def Snapshot.applyObservation (_today : Date) (obs : Observation) (fault : Option String) (s : Snapshot)
    (env : Environment) (_h : s.check = true) : StepResult :=
  match obs with
  | .dispatchPayment o =>
    withFault fault [("sentNoAnswer", DispatchPaymentUseCase.sentNoAnswer o s.startState)] fun f =>
      viaPort env (DispatchPaymentUseCase.request o s.startState) (DispatchPaymentUseCase.apply · o s.startState) f
  | .confirmPayment o =>
    withFault fault [] fun f =>
      direct env ((ConfirmPaymentUseCase.execute o s.startState).map s.putAttempts) f

def Snapshot.applyExternal (today : Date) (input : Input) (s : Snapshot) (env : Environment) (h : s.check = true) : StepResult :=
  match input with
  | .command actor cmd fault => s.applyCommand today actor cmd fault env h
  | .observation obs fault => s.applyObservation today obs fault env h

end Example.Runtime
`;
const lobbyJson = `namespace Example.Runtime
instance : FromJson Command where
  fromJson? j := match (j.getObjVal? "bookVisit").toOption, (j.getObjVal? "leave").toOption with
    | some p, _ => (fromJson? p).map Command.bookVisit | _, some p => (fromJson? p).map Command.leave | _, _ => .error "unknown command"
instance : FromJson Observation where
  fromJson? j := match (j.getObjVal? "dispatchPayment").toOption, (j.getObjVal? "confirmPayment").toOption with
    | some p, _ => (fromJson? p).map Observation.dispatchPayment | _, some p => (fromJson? p).map Observation.confirmPayment | _, _ => .error "unknown observation"
instance : ToJson Interaction where
  toJson
    | .paymentGatewayAuthorize r o => interaction "PaymentGateway" "authorize" (toJson r) (toJson o)
end Example.Runtime
`;
const lobbyMain = `import Example
def main : IO Unit := do
  match req.cmd with
  | "init" => respond (okResponse today s viewer)
  | "external" => respond (← runExternal x)
  | other => respond <| protocolError s!"unknown cmd: {other}"
`;
const lobby = {
  "Runtime/Command.lean": "namespace Example.Runtime\ninductive Command where\n  | bookVisit (c : BookVisitUseCase.Command)\n  | leave (c : LeaveUseCase.Command)\nderiving Repr\nend Example.Runtime\n",
  "Runtime/Observation.lean": "namespace Example.Runtime\ninductive Observation where\n  | dispatchPayment (o : DispatchPaymentUseCase.Observation)\n  | confirmPayment (o : ConfirmPaymentUseCase.Observation)\nderiving Repr\nend Example.Runtime\n",
  "Runtime/Json.lean": lobbyJson,
  "Runtime/Machine.lean": lobbyMachine,
  "Runtime/Environment.lean": "namespace Example.Runtime\ninductive Interaction where\n  | paymentGatewayAuthorize (r : Authorize.Request) (o : Authorize.Outcome)\nstructure Environment where\n  script : List Interaction\n  cursor : Nat\nend Example.Runtime\n",
  "Application/Port/PaymentGateway/Authorize.lean": "namespace Example.Application.Port.PaymentGateway.Authorize\nstructure Request where\n  amount : Nat\ninductive Outcome where\n  | authorized\n  | declined\nend Example.Application.Port.PaymentGateway.Authorize\n",
  "Main.lean": lobbyMain,
};

test("外部能力を持つ配線（合併型 2 つ・Port・環境・CLI）は、構成子ごとの腕が applyCommand / applyObservation に揃っていれば通る", (t) => {
  assert.deepEqual(fixture(t, lobby), []);
  // 腕を `| _ =>` でまとめると、その構成子の腕が無い
  const collapsed = fixture(t, { ...lobby, "Runtime/Machine.lean": lobbyMachine.replace("  | .confirmPayment o =>", "  | _ =>") });
  assert.deepEqual(collapsed.map(f => f.message), ["構成子 confirmPayment の腕が Machine.lean の applyObservation に無い"]);
});

test("外部能力の配線は揃って要る: Port があるのに環境が無い、環境と Main.lean の cmd external が片方だけ、は wiring の error", (t) => {
  const withoutEnv = { ...lobby };
  delete withoutEnv["Runtime/Environment.lean"];
  const messages = (files) => fixture(t, files).map(f => f.message);
  const noEnv = messages(withoutEnv);
  assert.ok(noEnv.some(m => /Port の置き場（Application\/Port か Domain\/Port）があるのに Runtime\/Environment\.lean/.test(m)), noEnv.join(" / "));
  assert.ok(noEnv.some(m => /Main\.lean が cmd external を受けるのに Runtime\/Environment\.lean が無い/.test(m)), noEnv.join(" / "));
  const legacyMain = messages({ ...lobby, "Main.lean": lobbyMain.replace('  | "external" => respond (← runExternal x)\n', "") });
  assert.deepEqual(legacyMain, ["Runtime/Environment.lean があるのに Main.lean が cmd external を受けない — 移行が半分（骨格の Main.lean で敷き直す。cradle doctor が差を出す）"]);
  // Port も環境も持たない骨格は、Main.lean が external を受けるだけなら片方だけ
  const halfMain = { ...lobby };
  delete halfMain["Runtime/Environment.lean"];
  delete halfMain["Application/Port/PaymentGateway/Authorize.lean"];
  assert.deepEqual(messages(halfMain), ["Main.lean が cmd external を受けるのに Runtime/Environment.lean が無い — 移行が半分"]);
  // コメントの中の "external" は受けているとは数えない
  const commentOnly = messages({ ...lobby, "Main.lean": lobbyMain.replace('  | "external" => respond (← runExternal x)\n', '  -- "external" は次の版で\n') });
  assert.equal(commentOnly.length, 1, commentOnly.join(" / "));
});
