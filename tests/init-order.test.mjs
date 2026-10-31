import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tempDir, cleanEnv, runNode } from "./helpers.mjs";

const init = fileURLToPath(new URL("../.apm/skills/cradle-init/scripts/init.mjs", import.meta.url));

const under = (dir, names) => names.map(n => `${dir}/${n}`);
const ktlint = (dir, suffix) => ["ActorContextSiteRule", "BypassSiteRule", "CradleRuleSetProvider", "JavaConfigBeanRule", "JooqAccessSiteRule", "NoRepositoryFakeRule", "PackageRootDeclarationRule", "PresentationCallsExecuteOnlyRule", "SingleClassPerFileRule"]
  .map(n => `backend/ktlint-rules/src/${dir}/kotlin/dev/cradle/ktlint/${n}${suffix}.kt`);
// 敷く順: documents → project の root（.apm・.claude・.codex・.github）→ cradle.json → .gitignore → lean → backend。
// 各置き場の中はディレクトリを名前順（大文字が先）に深さ優先でたどるので、lean/Demo/… が lean/Demo.lean より先に来る
const fullInit = [
  ...under("documents/ai-notes", ["README.md", "TEMPLATE.md"]),
  "documents/codebase/openapi.yaml",
  ...under("documents/ddd", ["event-timeline.md", "hotspots.md", "model-review.md", "ubiquitous-language.md", "ux-review.md"]),
  "documents/decisions.md",
  "documents/developer/README.md",
  ...under("documents/infra-design", ["01_model-to-infra.md", "02_local.md", "03_production.md", "04_operations.md", "README.md"]),
  ".apm/instructions/project.instructions.md",
  ".claude/settings.local.json.example",
  ".codex/config.toml",
  ".github/workflows/cradle.yml",
  "cradle.json",
  ".gitignore",
  ...under("lean", [".gitignore", "Main.lean", "README.md"]),
  ...under("lean/Demo/Application", ["ActorContext.lean", "Composition/NoteLifecycle.lean", "Projection.lean", "ReadModel.lean", "RepositoryState.lean",
    "UseCase/CloseNoteUseCase/Command.lean", "UseCase/CloseNoteUseCase/UseCase.lean",
    "UseCase/NotesUseCase/QueryService.lean", "UseCase/NotesUseCase/ReadModel.lean", "UseCase/NotesUseCase/UseCase.lean",
    "UseCase/PostNoteUseCase/Command.lean", "UseCase/PostNoteUseCase/UseCase.lean", "View.lean"]),
  ...under("lean/Demo/Domain", ["Annotations.lean", "Entity/Note.lean", "Error.lean", "ValueObject.lean"]),
  "lean/Demo/Laws/Properties.lean",
  "lean/Demo/Prelude.lean",
  ...under("lean/Demo/Runtime", ["Command.lean", "Environment.lean", "Ids.lean", "Json.lean", "Machine.lean", "Observation.lean", "Protocol.lean", "Reachable.lean", "Scenarios.lean", "Views.lean"]),
  "lean/Demo.lean",
  ...under("lean/golden", ["basic-flow.json", "basic-init.json", "basic.request.json", "external-flow.json", "external-init.json", "external.request.json"]),
  ...under("lean", ["lakefile.toml", "lean-toolchain", "mockup/public/index.html", "mockup/server.mjs"]),
  ...under("backend", [".editorconfig", "gradle.properties", "ktlint-rules/build.gradle.kts"]),
  ...ktlint("main", ""),
  "backend/ktlint-rules/src/main/resources/META-INF/services/com.pinterest.ktlint.cli.ruleset.core.api.RuleSetProviderV3",
  ...ktlint("test", "Test"),
];
const next = "\n次: apm install（固有の事実を rules に写す。Codex は apm compile --single-agents）  →  cd lean && lake build  →  cradle status  →  ddd スキルで探索を始める\n";
const noDomain = "\nプロダクトの一言は書いていない（documents/ddd/event-timeline.md 冒頭の「プロダクト:」行）。ddd.mjs start --domain \"<一言>\" が書く。\n";

test("init は骨格を決まった順に敷いて + で並べ、--only lean/mockup --force はモックアップの 2 ファイルだけを敷き直す", (t) => {
  const root = tempDir(t, "cradle-init-order-");
  const env = cleanEnv();
  const full = runNode(init, ["--project", "Demo", "--dir", root, "--backend", "com.example.demo"], { cwd: root, env });
  assert.equal(full.status, 0, full.stderr);
  assert.equal(full.stderr, "");
  assert.equal(full.stdout, `Cradle init — Demo (${root})\n${fullInit.map(p => `  + ${p}`).join("\n")}\n${noDomain}${next}`);
  const mockup = runNode(init, ["--project", "Demo", "--dir", root, "--only", "lean/mockup", "--force"], { cwd: root, env });
  assert.equal(mockup.status, 0, mockup.stderr);
  assert.equal(mockup.stdout, `Cradle init — Demo (${root})\n  + lean/mockup/public/index.html\n  + lean/mockup/server.mjs\n${next}`);
});

test("init の --backend はパッケージ名を骨格を敷く前に確かめ、名前が誤っていれば何も書かずに 1 で終わる", (t) => {
  const root = tempDir(t, "cradle-init-backend-");
  const r = runNode(init, ["--project", "Demo", "--dir", root, "--backend", "Bad.Pkg"], { cwd: root, env: cleanEnv() });
  assert.deepEqual([r.status, r.stdout, r.stderr], [1, "", "--backend は Java のパッケージ名（例: com.example.notes）\n"]);
  assert.deepEqual(readdirSync(root), []);
});
