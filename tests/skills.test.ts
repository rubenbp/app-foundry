import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  snapshotSkills,
  verifySkills,
} from "../src/infrastructure/opencode/skills.ts";

test("los Intentos conservan instrucciones, referencias y scripts; otra Ejecución recibe las actualizaciones", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundry-skills-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const skill = join(source, "review");
  mkdirSync(join(skill, "references"), { recursive: true });
  mkdirSync(join(skill, "scripts"));
  writeFileSync(join(skill, "SKILL.md"), "Original instructions");
  writeFileSync(join(skill, "references", "rules.md"), "Original rules");
  writeFileSync(join(skill, "scripts", "check.sh"), "exit 0\n", {
    mode: 0o700,
  });
  const first = snapshotSkills(source, join(root, "execution-1"));
  writeFileSync(join(skill, "SKILL.md"), "Updated instructions");
  writeFileSync(join(skill, "references", "rules.md"), "Updated rules");
  writeFileSync(join(skill, "scripts", "check.sh"), "exit 1\n");
  const second = snapshotSkills(source, join(root, "execution-2"));
  rmSync(source, { recursive: true });
  const resumed = snapshotSkills(source, join(root, "execution-1"));
  assert.deepEqual(resumed, first);
  assert.deepEqual(first.entries, [
    { id: "review", path: join(first.directory, "review", "SKILL.md") },
  ]);
  for (const [path, original, updated] of [
    ["SKILL.md", "Original instructions", "Updated instructions"],
    ["references/rules.md", "Original rules", "Updated rules"],
    ["scripts/check.sh", "exit 0\n", "exit 1\n"],
  ]) {
    assert.equal(
      readFileSync(join(first.directory, "review", path), "utf8"),
      original,
    );
    assert.equal(
      readFileSync(join(second.directory, "review", path), "utf8"),
      updated,
    );
  }
});

test("el catálogo vacío es válido y una copia fallida no queda publicada", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundry-skills-empty-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const runtime = join(root, "execution");
  assert.throws(() => snapshotSkills(source, runtime), /ENOENT/);
  assert.deepEqual(readdirSync(runtime), []);
  mkdirSync(source);
  writeFileSync(join(source, ".gitkeep"), "");
  const catalog = snapshotSkills(source, runtime);
  assert.deepEqual(catalog.entries, []);
  verifySkills(catalog, []);
});

test("se rechaza una skill ausente o cuyo ID resuelve fuera de la copia de la Ejecución", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundry-skills-origin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  mkdirSync(join(source, "review"), { recursive: true });
  writeFileSync(join(source, "review", "SKILL.md"), "Trusted");
  const catalog = snapshotSkills(source, join(root, "execution"));
  assert.throws(() => verifySkills(catalog, []), /snapshot: review/);
  assert.throws(
    () =>
      verifySkills(catalog, [
        { id: "review", path: join(source, "review", "SKILL.md") },
      ]),
    /snapshot: review/,
  );
  verifySkills(catalog, catalog.entries);
});
