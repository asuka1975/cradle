import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const leanCheck = fileURLToPath(new URL("../.apm/skills/cradle/scripts/lean-check.mjs", import.meta.url));

// 一時プロジェクト: UseCase ディレクトリの形と Runtime の配線だけを持つ Lean モデル（lake build はしない）
function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "cradle-lean-check-forms-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "cradle.json"), JSON.stringify({ project: "Example" }));
  for (const [rel, text] of Object.entries(files)) {
    const f = join(root, "lean/Example", rel);
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
