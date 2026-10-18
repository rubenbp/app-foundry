import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, "src");
const sources = readdirSync(sourceRoot, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".ts"))
  .map((file) => resolve(sourceRoot, file));
const allowedLayers: Record<string, string[]> = {
  domain: ["domain"],
  application: ["domain", "application"],
  infrastructure: ["domain", "application", "infrastructure"],
  composition: ["domain", "application", "infrastructure", "composition"],
};

function imports(file: string) {
  return ts.preProcessFile(readFileSync(file, "utf8"), true).importedFiles;
}

// Includes erased type imports: contracts must point inward too.
test("hexagonal layers depend inward and adapters never import composition", () => {
  for (const file of sources) {
    const name = relative(sourceRoot, file);
    const layer = name.split(sep)[0];
    if (name === "cli.ts") continue;
    assert.ok(allowedLayers[layer], `Production module has no layer: ${name}`);
    for (const entry of imports(file)) {
      if (!entry.fileName.startsWith(".")) {
        if (layer === "domain" || layer === "application")
          assert.ok(
            entry.fileName.startsWith("node:"),
            `${name} imports an external provider: ${entry.fileName}`,
          );
        continue;
      }
      const target = resolve(dirname(file), entry.fileName);
      const targetLayer = relative(sourceRoot, target).split(sep)[0];
      assert.ok(
        allowedLayers[layer].includes(targetLayer),
        `${name} must not depend on ${relative(sourceRoot, target)}`,
      );
    }
  }
});

test("domain and application do not acquire filesystem, network or process effects", () => {
  const effectModules =
    /^node:(?:fs|sqlite|http|https|net|child_process|worker_threads)(?:\/|$)/;
  for (const file of sources) {
    const name = relative(sourceRoot, file);
    if (!["domain", "application"].includes(name.split(sep)[0])) continue;
    for (const entry of imports(file))
      assert.ok(
        !effectModules.test(entry.fileName),
        `${name} must acquire effects through an application port`,
      );
  }
});

test("the browser uses shared read contracts without importing backend effects", () => {
  const panelRoot = resolve(root, "panel");
  for (const name of readdirSync(panelRoot, {
    recursive: true,
    encoding: "utf8",
  })) {
    if (!/\.tsx?$/.test(name)) continue;
    const file = resolve(panelRoot, name);
    for (const entry of imports(file)) {
      assert.ok(!entry.fileName.startsWith("node:"), `${name} imports Node`);
      if (!entry.fileName.startsWith(".")) continue;
      const target = relative(
        sourceRoot,
        resolve(dirname(file), entry.fileName),
      );
      assert.ok(
        !/^(?:infrastructure|composition)(?:\/|$)/.test(target),
        `${name} imports a runtime adapter: ${entry.fileName}`,
      );
    }
  }
});
