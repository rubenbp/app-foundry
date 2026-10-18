import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { once } from "node:events";
import { join } from "node:path";
import { verificationFixture } from "./support/verification.ts";
import { execute } from "../src/infrastructure/process.ts";

test("el Workflow detiene la edición antes de fijar un candidato completo con varios commits y guarda evidencias independientes", async () => {
  const s = verificationFixture();
  try {
    const run = await s.start();
    s.commit("catalogue.txt", "First change", "Add catalogue");
    s.onStop(() => s.commit("footer.txt", "Last change", "Add footer"));
    s.finish();
    const verified = await s.workflow.verifyCandidate();
    assert.equal(verified?.status, "awaiting_preview");
    assert.equal(verified.phase, "verification");
    assert.equal(verified.process?.exited, true);
    const report = verified.verification!;
    assert.equal(report.baseSha, s.baseSha);
    assert.equal(report.headSha, s.git("rev-parse", "HEAD"));
    assert.equal(report.status, "passed");
    assert.equal(report.checks[0].status, "passed");
    assert.equal(report.checks[0].code, 0);
    assert.match(s.workflow.output(run.id, report.diffPartId)!, /First change/);
    assert.match(s.workflow.output(run.id, report.diffPartId)!, /Last change/);
    assert.match(
      s.workflow.output(run.id, report.checks[0].partId)!,
      /catalogue checked/,
    );
    assert.equal(report.criteria[0].status, "human_pending");
    assert.deepEqual(report.criteria[0].evidence, [report.checks[0].partId]);
    assert.match(report.criteria[0].missing.join(" "), /criterion-specific/i);
    s.reopen();
    assert.equal(
      s.workflow.view(run.id)?.verification?.headSha,
      report.headSha,
    );
    assert.equal(await s.workflow.verifyCandidate(), null);
  } finally {
    s.close();
  }
});

test("la verificación detecta un defecto de un commit anterior aunque el último commit no lo modifique", async () => {
  const s = verificationFixture();
  try {
    const run = await s.start();
    s.commit("catalogue.txt", "defect", "Introduce earlier defect");
    s.commit("footer.txt", "Unrelated final commit", "Update footer");
    s.finish();
    const result = (await s.workflow.verifyCandidate())!;
    assert.equal(result.status, "intervention");
    assert.equal(result.verification?.status, "failed");
    assert.equal(result.verification?.checks[0].code, 7);
    assert.match(
      s.workflow.output(run.id, "verification-check-1")!,
      /earlier defect/,
    );
    assert.match(s.workflow.output(run.id, "verification-diff")!, /\+defect/);
    assert.equal(result.verification?.criteria[0].status, "missing_evidence");
    assert.equal(s.workflow.factory.active, run.id);
  } finally {
    s.close();
  }
});

test("el diff acumulado y la salida extensos se conservan íntegros tras el saneamiento", async () => {
  let checks = 0;
  const s = verificationFixture({
    process: async (command, args, options) => {
      if (
        command === "/bin/sh" &&
        args[1] === "node check.mjs" &&
        ++checks === 2
      )
        return {
          code: 0,
          output:
            "Long command output\n" +
            "x".repeat(70_000) +
            "\nFINAL EVIDENCE password=private-pretend-value",
        };
      return execute(command, args, options);
    },
  });
  try {
    await s.start();
    s.commit(
      "long.txt",
      "Full candidate diff\n" + "x".repeat(70_000) + "\nFINAL DIFF EVIDENCE",
      "Large change",
    );
    s.finish();
    const result = (await s.workflow.verifyCandidate())!;
    assert.equal(result.status, "awaiting_preview");
    assert.match(
      s.workflow.output(result.id, "verification-diff")!,
      /FINAL DIFF EVIDENCE/,
    );
    assert.match(
      s.workflow.output(result.id, "verification-check-1")!,
      /FINAL EVIDENCE password=\[REDACTED\]/,
    );
    assert.equal(
      result.parts.find((part) => part.id === "verification-diff")?.truncated,
      false,
    );
    s.reopen();
    assert.match(
      s.workflow.output(result.id, "verification-diff")!,
      /FINAL DIFF EVIDENCE/,
    );
  } finally {
    s.close();
  }
});

test("las evidencias truncadas de un comando no pueden aprobar un candidato, aunque termine con código cero", async () => {
  let checks = 0;
  const s = verificationFixture({
    process: async (command, args, options) => {
      if (
        command === "/bin/sh" &&
        args[1] === "node check.mjs" &&
        ++checks === 2
      )
        return {
          code: 0,
          output: "Partial evidence\n[TRUNCATED]",
          truncated: true,
        };
      return execute(command, args, options);
    },
  });
  try {
    await s.start();
    s.finish();
    const result = (await s.workflow.verifyCandidate())!;
    assert.equal(result.status, "intervention");
    assert.equal(result.verification?.checks[0].code, 0);
    assert.equal(result.verification?.checks[0].status, "failed");
    assert.match(result.error!, /truncated/);
  } finally {
    s.close();
  }
});

test("los cambios versionados sin confirmar, preparados y sin seguimiento no pueden formar un candidato verificado", async () => {
  for (const mode of ["tracked", "staged", "untracked"]) {
    const s = verificationFixture();
    try {
      await s.start();
      const path = mode === "tracked" ? "catalogue.txt" : "new.txt";
      writeFileSync(join(s.directory, path), "Unincorporated agent edit");
      if (mode === "staged") s.git("add", "new.txt");
      s.finish();
      const result = (await s.workflow.verifyCandidate())!;
      assert.equal(result.status, "intervention");
      assert.match(result.error!, /uncommitted/i);
      assert.equal(result.verification?.checks[0].status, "not_run");
      assert.match(
        s.workflow.output(result.id, "verification-worktree")!,
        /catalogue.txt|new.txt/,
      );
    } finally {
      s.close();
    }
  }
});

test("una parada incierta del agente nunca fija un commit ni ejecuta comprobaciones del candidato", async () => {
  const s = verificationFixture({ stopConfirmed: false });
  try {
    await s.start();
    s.finish();
    const result = (await s.workflow.verifyCandidate())!;
    assert.equal(result.status, "intervention");
    assert.equal(result.verification?.headSha, null);
    assert.equal(result.verification?.checks[0].status, "not_run");
    assert.match(result.error!, /stop unconfirmed/i);
  } finally {
    s.close();
  }
});

test("quitar comandos o borrar, omitir, aislar o debilitar pruebas requiere intervención humana", async () => {
  for (const change of ["command", "delete", "skip", "only", "weaken"]) {
    const s = verificationFixture({
      files: {
        "package.json": JSON.stringify({
          scripts: { verify: "node check.mjs" },
        }),
        "tests/catalogue.test.js":
          "test('catalogue', () => { assert.equal(games.length, 3); });\n",
      },
    });
    try {
      await s.start();
      if (change === "command")
        s.commit("package.json", '{"scripts":{}}', "Remove command");
      else if (change === "delete") {
        s.git("rm", "tests/catalogue.test.js");
        s.git("commit", "-m", "Delete coverage");
      } else
        s.commit(
          "tests/catalogue.test.js",
          change === "weaken"
            ? "test('catalogue', () => {});\n"
            : `test.${change}('catalogue', () => {});\n`,
          "Alter control",
        );
      s.finish();
      const result = (await s.workflow.verifyCandidate())!;
      assert.equal(result.status, "intervention", change);
      assert.equal(result.verification?.checks[0].status, "not_run");
      assert.ok(result.verification?.controls.length);
      assert.match(result.error!, /controls.*human/i);
      assert.match(
        s.workflow.output(result.id, "verification-controls")!,
        /package.json|catalogue.test.js/,
      );
    } finally {
      s.close();
    }
  }
});

test("se permiten pruebas de comportamiento nuevas", async () => {
  const s = verificationFixture();
  try {
    await s.start();
    mkdirSync(join(s.directory, "tests"));
    s.commit(
      "tests/catalogue.test.js",
      "test('keyboard', () => { assert.ok(focused); });\n",
      "Add coverage",
    );
    s.finish();
    const result = (await s.workflow.verifyCandidate())!;
    assert.equal(result.verification?.status, "passed");
  } finally {
    s.close();
  }
});

test("una prueba recién aislada y una fuente de comandos editada no pueden eludir la revisión de control", async () => {
  for (const path of ["tests/new.test.js", "check.mjs"]) {
    const s = verificationFixture();
    try {
      await s.start();
      mkdirSync(join(s.directory, "tests"));
      s.commit(
        path,
        path === "check.mjs"
          ? "process.exit(0);"
          : "test.only('new', () => {});",
        "Alter verification surface",
      );
      s.finish();
      const result = (await s.workflow.verifyCandidate())!;
      assert.equal(result.status, "intervention");
      assert.equal(result.verification?.checks[0].status, "not_run");
      assert.ok(result.verification?.controls[0].includes(path));
    } finally {
      s.close();
    }
  }
});

test("las consultas verifican una vez el Intento finalizado y una finalización tardía del agente no puede reabrir la edición", async () => {
  const s = verificationFixture();
  try {
    const run = await s.start();
    s.finish();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_preview");
    s.finish();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_preview");
    assert.equal(
      s.workflow
        .view(run.id)
        ?.history.filter((entry) => entry.kind === "agent-stop").length,
      1,
    );
  } finally {
    s.close();
  }
});

test("si un comando no está disponible en el candidato, falla con su salida y los comandos posteriores no se aprueban", async () => {
  let checks = 0;
  const s = verificationFixture({
    commands: ["node check.mjs", "node --version"],
    process: async (command, args, options) => {
      if (
        command === "/bin/sh" &&
        args[1] === "node check.mjs" &&
        ++checks === 2
      )
        return {
          code: 127,
          output:
            "verification tool: command not found\npassword=pretend-sensitive-value",
        };
      return execute(command, args, options);
    },
  });
  try {
    await s.start();
    s.finish();
    const result = (await s.workflow.verifyCandidate())!;
    assert.equal(result.status, "intervention");
    assert.equal(result.verification?.checks[0].code, 127);
    assert.equal(result.verification?.checks[1].status, "not_run");
    assert.equal(result.verification?.checks[1].code, null);
    const output = s.workflow.output(result.id, "verification-check-1")!;
    assert.match(output, /command not found/);
    assert.ok(!output.includes("pretend-sensitive-value"));
    s.reopen();
    assert.equal(s.workflow.output(result.id, "verification-check-1"), output);
  } finally {
    s.close();
  }
});

test("el código cero sin un informe E2E ejecutado, o con pruebas omitidas, no puede aprobar la comprobación E2E", async () => {
  for (const mode of ["absent", "skipped", "passed"]) {
    const s = verificationFixture({
      commands: ["node e2e.mjs"],
      files: { "e2e.mjs": "console.log('base check')" },
      process: async (command, args, options) => {
        if (command === "/bin/sh" && args[1]?.includes("--config")) {
          return {
            code: 0,
            output:
              mode === "absent"
                ? "No tests executed"
                : 'FACTORY_E2E_METADATA=[{"name":"chromium","channel":"chrome","executablePath":null}]\n' +
                  JSON.stringify(
                    {
                      config: {},
                      stats: {
                        expected: 1,
                        unexpected: 0,
                        flaky: 0,
                        skipped: mode === "skipped" ? 1 : 0,
                      },
                      errors: [],
                    },
                    null,
                    2,
                  ),
          };
        }
        return execute(command, args, options);
      },
    });
    s.project.verification.e2e = {
      command: "node e2e.mjs",
      configFile: "playwright.config.mjs",
      serverCommand:
        "python3 -m http.server 4173 --bind 127.0.0.1 --directory dist",
      origin: "http://127.0.0.1:4173",
      serves: "dist",
      reuseExistingServer: false,
      offline: false,
    };
    try {
      await s.start();
      s.finish();
      const result = (await s.workflow.verifyCandidate())!;
      if (mode === "passed") {
        assert.equal(result.status, "awaiting_preview");
        assert.equal(result.verification?.e2e?.browsers[0].name, "chromium");
        assert.equal(result.verification?.e2e?.executedTests, 1);
        assert.equal(result.verification?.e2e?.reuseExistingServer, false);
      } else {
        assert.equal(result.status, "intervention");
        assert.equal(result.verification?.checks[0].status, "failed");
        assert.equal(result.verification?.checks[0].code, 0);
        assert.match(result.error!, /E2E evidence/);
      }
    } finally {
      s.close();
    }
  }
});

test("cancelar la verificación termina el comando real antes de liberar la Ejecución activa", async () => {
  const s = verificationFixture({
    commands: ["node wait.mjs"],
    files: {
      ".gitignore": "verification.pid\n",
      "wait.mjs":
        "import {existsSync,writeFileSync} from 'node:fs'; if(existsSync('wait.flag')) {writeFileSync('verification.pid',String(process.pid));console.log('Waiting command');setInterval(()=>{},1000)} else console.log('base verified');",
    },
  });
  try {
    await s.start();
    s.commit("wait.flag", "wait", "Long candidate check");
    s.finish();
    const verification = s.workflow.verifyCandidate();
    const path = join(s.directory, "verification.pid");
    for (let count = 0; count < 200 && !existsSync(path); count++)
      await delay(10);
    assert.ok(existsSync(path), "Candidate command started");
    const pid = Number(readFileSync(path, "utf8"));
    const stopped = await s.workflow.stop(s.workflow.factory.active!);
    await verification;
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.verification?.checks[0].code, null);
    assert.equal(stopped.verification?.checks[0].status, "failed");
    assert.equal(s.workflow.factory.active, null);
    assert.throws(() => process.kill(pid, 0));
  } finally {
    s.close();
  }
});

test("la verificación registra la intención antes de detener al agente y bloquea efectos si SQLite no está disponible", async () => {
  const s = verificationFixture();
  let stopped = false;
  s.onStop(() => {
    stopped = true;
  });
  let blocker: DatabaseSync | undefined;
  try {
    await s.start();
    s.finish();
    blocker = new DatabaseSync(join(s.config.dataDir, "factory.sqlite"));
    blocker.exec("BEGIN IMMEDIATE");
    await assert.rejects(
      s.workflow.verifyCandidate(),
      /Persistence unavailable/,
    );
    assert.equal(stopped, false);
    assert.match(s.workflow.factory.fault!, /Persistence failed/);
  } finally {
    blocker?.exec("ROLLBACK");
    blocker?.close();
    s.close();
  }
});

test("tras reiniciar, se conserva la identidad del proceso verificador y no se liberan efectos inciertos del comando", async () => {
  const s = verificationFixture({
    commands: ["node wait.mjs"],
    files: {
      "wait.mjs":
        "import {existsSync} from 'node:fs'; if(existsSync('wait.flag')) setInterval(()=>{},1000);",
    },
  });
  let pid: number | null = null;
  let verification: ReturnType<typeof s.workflow.verifyCandidate> | undefined;
  try {
    const run = await s.start();
    s.commit("wait.flag", "wait", "Observe restart during verification");
    s.finish();
    verification = s.workflow.verifyCandidate();
    void verification.catch(() => {});
    for (let count = 0; count < 200 && !pid; count++) {
      pid = s.workflow.view(run.id)?.verification?.checks[0].pid ?? null;
      if (!pid) await delay(10);
    }
    assert.ok(pid);
    s.reopen();
    const recovered = s.workflow.view(run.id)!;
    assert.equal(recovered.verification?.checks[0].pid, pid);
    assert.equal(recovered.verification?.checks[0].status, "uncertain");
    assert.equal((await s.workflow.stop(run.id)).status, "intervention");
    assert.equal(s.workflow.factory.active, run.id);
    process.kill(-pid, "SIGTERM");
    await verification.catch(() => {});
    pid = null;
  } finally {
    if (pid) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* Already absent. */
      }
    }
    await verification?.catch(() => {});
    s.close();
  }
});

test("si se reinicia mientras la limpieza E2E está pendiente, se conserva el turno aunque el comando haya terminado", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const s = verificationFixture({
    commands: ["node e2e.mjs"],
    e2e: {
      command: "node e2e.mjs",
      configFile: "playwright.config.mjs",
      serverCommand: "configured-static-server",
      origin: `http://127.0.0.1:${port}`,
      serves: "dist",
      reuseExistingServer: false,
      offline: false,
    },
    files: { "e2e.mjs": "console.log('base')" },
    process: async (command, args, options) => {
      if (command === "/bin/sh" && args[1]?.includes("--config")) {
        options.onStart?.(424242);
        server.listen(port, "127.0.0.1");
        await once(server, "listening");
        return {
          code: 0,
          output:
            'FACTORY_E2E_METADATA=[{"name":"chromium","channel":"chrome","executablePath":null}]\n' +
            JSON.stringify(
              {
                config: {},
                stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
                errors: [],
              },
              null,
              2,
            ),
        };
      }
      return execute(command, args, options);
    },
  });
  let verification: ReturnType<typeof s.workflow.verifyCandidate> | undefined;
  try {
    const run = await s.start();
    s.finish();
    verification = s.workflow.verifyCandidate();
    void verification.catch(() => {});
    for (
      let count = 0;
      count < 200 &&
      s.workflow.view(run.id)?.verification?.checks[0].code !== 0;
      count++
    )
      await delay(10);
    assert.equal(s.workflow.view(run.id)?.verification?.checks[0].code, 0);
    s.reopen();
    const recovered = await s.workflow.stop(run.id);
    assert.equal(recovered.status, "intervention");
    assert.equal(recovered.verification?.effectsUncertain, true);
    assert.equal(s.workflow.factory.active, run.id);
  } finally {
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await verification?.catch(() => {});
    s.close();
  }
});
