import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { FactoryView } from "../src/application/factoryView.ts";
import { createFactory } from "../src/composition/factory.ts";
import { panelServer } from "../src/infrastructure/http/panelServer.ts";
import { runCommands } from "../src/infrastructure/cli/runCommands.ts";
import { setup } from "./support/admission.ts";

test("los comandos de emergencia conservan rutas e ID literales con espacios, comillas y sintaxis shell", () => {
  const s = setup();
  try {
    const nodePath = join(s.root, "node ' $(touch INJECTED)");
    const cliPath = join(
      s.root,
      "factory ' $(touch INJECTED)",
      "src",
      "cli.ts",
    );
    const id = "run ' $(touch INJECTED)";
    const capture = join(s.root, "arguments.json");
    writeFileSync(
      nodePath,
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.CAPTURE, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));`,
      { mode: 0o700 },
    );
    const commands = runCommands(id, { nodePath, cliPath, canDiscard: true });
    for (const action of ["stop", "discard"] as const) {
      const result = spawnSync("/bin/bash", ["-c", commands[action]!], {
        cwd: realpathSync(s.root),
        env: { PATH: process.env.PATH, CAPTURE: capture },
        encoding: "utf8",
        timeout: 5000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(readFileSync(capture, "utf8")), {
        cwd: realpathSync(s.root),
        args: [
          "--experimental-strip-types",
          cliPath,
          action,
          "--config",
          "./factory.local.json",
          "--id",
          id,
        ],
      });
      assert.equal(existsSync(join(s.root, "INJECTED")), false);
    }
    assert.equal(
      runCommands(id, { nodePath, cliPath, canDiscard: false }).discard,
      null,
    );
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("el comando del Dashboard descarta desde la carpeta de factory.local.json sin package.json ni cambiar al repositorio", async () => {
  const s = setup();
  mkdirSync(s.config.projectDir, { recursive: true });
  writeFileSync(
    join(s.root, "project.json"),
    JSON.stringify(s.config.managedProject),
  );
  writeFileSync(
    join(s.root, "factory.local.json"),
    JSON.stringify({
      ...s.config,
      managedProjectFile: "project.json",
      opencodeCli: "/nonexistent/opencode",
    }),
  );
  const factory = createFactory(s.config, s.agent);
  const run = factory.enqueue("Emergency command from configured folder");
  run.status = "intervention";
  factory.persist(run);
  const server = panelServer(factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let command: string;
  try {
    const response: FactoryView = await fetch(
      `http://127.0.0.1:${(server.address() as { port: number }).port}/api/view?run=${run.id}`,
    ).then((response) => response.json());
    assert.ok(response.emergencyCommands?.discard);
    command = response.emergencyCommands.discard;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    factory.close();
  }
  try {
    assert.equal(existsSync(join(s.root, "package.json")), false);
    const result = spawnSync("/bin/bash", ["-c", command], {
      cwd: s.root,
      env: { HOME: s.root, PATH: process.env.PATH },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Puesto liberado/);
    assert.ok(result.stdout.includes(run.id));
    const restored = createFactory(s.config, s.agent);
    try {
      assert.equal(restored.view(run.id)?.stopReason, "discarded");
    } finally {
      restored.close();
    }
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});
