import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createFactory } from "../src/composition/factory.ts";
import { createWorkflow } from "../src/composition/workflow.ts";
import { discardExecution } from "../src/composition/discard.ts";
import { acquireWorkflowOwnership } from "../src/infrastructure/ownership.ts";
import { Store } from "../src/infrastructure/persistence/store.ts";
import { assertRunProcessesStopped } from "../src/infrastructure/runProcesses.ts";
import { verificationPlan } from "../src/domain/verification.ts";
import { publicationPlan } from "../src/domain/publication.ts";
import type { RunStatus } from "../src/domain/run.ts";
import { discardRun } from "../src/domain/run.ts";
import { setup } from "./support/admission.ts";

function fixture(status: RunStatus = "intervention") {
  const s = setup();
  const factory = createFactory(s.config, s.agent);
  const run = factory.enqueue("Discard blocked execution");
  run.status = status;
  run.error = "Keep original failure";
  factory.persist(run);
  factory.store.write(run.id, "output", "Keep original evidence");
  factory.close();
  const ownership = acquireWorkflowOwnership(s.config);
  ownership.reserve(run.id);
  ownership.close();

  return {
    ...s,
    run,
    read() {
      const store = new Store(s.config.dataDir);
      try {
        return store.list().find((item) => item.id === run.id)!;
      } finally {
        store.close();
      }
    },
    close() {
      const ownership = acquireWorkflowOwnership(s.config);
      ownership.releaseRun(run.id);
      ownership.close();
      rmSync(s.root, { recursive: true, force: true });
    },
  };
}

for (const status of [
  "preparing",
  "running",
  "waiting",
  "verifying",
  "awaiting_review",
  "closing_issue",
  "intervention",
] as const) {
  test(`descartar una Ejecución ${status} libera la reserva, conserva la evidencia y permite repetir el comando`, () => {
    const s = fixture(status);
    try {
      const store = new Store(s.config.dataDir);
      s.run.verification = verificationPlan("a".repeat(40), [], "Criteria");
      s.run.verification.effectsUncertain = true;
      if (status === "closing_issue") {
        s.run.publication = publicationPlan("b".repeat(40));
        s.run.publication.mergeSha = "c".repeat(40);
      }
      store.save(s.run);
      store.close();
      const first = discardExecution(
        { ...s.config, model: "another-model" },
        s.run.id,
      );
      assert.equal(first.status, "stopped");
      assert.equal(first.stopReason, "discarded");
      assert.equal(first.error, s.run.error);
      assert.deepEqual(first.verification, s.run.verification);
      assert.deepEqual(first.publication, s.run.publication);
      assert.ok(first.endedAt);
      const ownership = acquireWorkflowOwnership(s.config);
      assert.equal(ownership.reservation(), null);
      ownership.close();
      assert.deepEqual(discardExecution(s.config, s.run.id), first);
      const restored = createFactory(s.config, s.agent);
      try {
        assert.equal(restored.active, null);
        assert.equal(
          restored.output(s.run.id, "output"),
          "Keep original evidence",
        );
        assert.equal(
          restored
            .view(s.run.id)
            ?.history.filter((event) => event.kind === "discarded").length,
          1,
        );
      } finally {
        restored.close();
      }
    } finally {
      s.close();
    }
  });
}

test("el descarte no exige reinicio y admite una reserva que desapareció de /tmp", () => {
  const s = fixture();
  try {
    const ownership = acquireWorkflowOwnership(s.config);
    ownership.releaseRun(s.run.id);
    ownership.close();
    assert.equal(discardExecution(s.config, s.run.id).status, "stopped");
  } finally {
    s.close();
  }
});

test("un fallo de persistencia no libera la reserva y un descarte guardado antes de una interrupción permite liberar después", () => {
  const s = fixture();
  const blocker = new DatabaseSync(join(s.config.dataDir, "factory.sqlite"));
  try {
    blocker.exec("BEGIN IMMEDIATE");
    assert.throws(() => discardExecution(s.config, s.run.id), /locked/);
    blocker.exec("ROLLBACK");
    assert.equal(s.read().status, "intervention");
    const ownership = acquireWorkflowOwnership(s.config);
    assert.equal(ownership.reservation(), s.run.id);
    ownership.close();
    // Simulate interruption after the durable terminal write but before releasing ownership.
    const store = new Store(s.config.dataDir);
    store.save(discardRun(s.run, 123));
    store.close();
    assert.equal(discardExecution(s.config, s.run.id).endedAt, 123);
    const released = acquireWorkflowOwnership(s.config);
    assert.equal(released.reservation(), null);
    released.close();
  } finally {
    blocker.close();
    s.close();
  }
});

test("los locks rechazan una Factory activa, otra reserva y otro data root sin alterar la ejecución", () => {
  const s = fixture();
  try {
    const ownership = acquireWorkflowOwnership(s.config);
    try {
      assert.throws(
        () => discardExecution(s.config, s.run.id),
        /Another Factory/,
      );
    } finally {
      ownership.close();
    }
    assert.throws(
      () =>
        discardExecution(
          { ...s.config, dataDir: join(s.root, "other-data") },
          s.run.id,
        ),
      /another data root/,
    );
    const reserved = acquireWorkflowOwnership(s.config);
    reserved.releaseRun(s.run.id);
    reserved.reserve("another-run");
    reserved.close();
    try {
      assert.throws(
        () => discardExecution(s.config, s.run.id),
        /Otra Ejecución/,
      );
      assert.equal(s.read().status, "intervention");
    } finally {
      const cleanup = acquireWorkflowOwnership(s.config);
      cleanup.releaseRun("another-run");
      cleanup.close();
    }
  } finally {
    s.close();
  }
});

for (const location of ["agent", "verification", "connection"] as const) {
  test(`rechaza el descarte con un proceso ${location} vivo y permite hacerlo después de pararlo manualmente`, async () => {
    const s = fixture();
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { detached: true, stdio: "ignore" },
    );
    await once(child, "spawn");
    try {
      const pid = child.pid!;
      if (location === "agent") {
        s.run.process = { pid, version: "test", configuration: {} };
      } else if (location === "verification") {
        s.run.verification = verificationPlan(
          "a".repeat(40),
          ["npm test"],
          "Criteria",
        );
        s.run.verification.checks[0].pid = pid;
      } else {
        const directory = join(s.config.dataDir, "conversations", s.run.id);
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          join(directory, "connection.json"),
          JSON.stringify({ pid, password: "private-test-password" }),
        );
      }
      const store = new Store(s.config.dataDir);
      store.save(s.run);
      store.close();
      assert.throws(() => discardExecution(s.config, s.run.id), /sigue activo/);
      assert.equal(s.read().status, "intervention");
      const exit = once(child, "exit");
      process.kill(-pid, "SIGTERM");
      await exit;
      assert.equal(discardExecution(s.config, s.run.id).status, "stopped");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exit = once(child, "exit");
        process.kill(-child.pid!, "SIGKILL");
        await exit;
      }
      s.close();
    }
  });
}

test("un grupo con hijos vivos bloquea el descarte aunque su proceso principal haya terminado", async () => {
  const s = fixture();
  const leader = spawn(
    process.execPath,
    [
      "-e",
      `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)'], { stdio: 'ignore' });
    child.unref();
  `,
    ],
    { detached: true, stdio: "ignore" },
  );
  try {
    const [code] = await once(leader, "exit");
    assert.equal(code, 0);
    assert.throws(() => process.kill(leader.pid!, 0), { code: "ESRCH" });
    s.run.process = { pid: leader.pid!, version: "test", configuration: {} };
    assert.throws(
      () => assertRunProcessesStopped(s.config.dataDir, s.run),
      /sigue activo/,
    );
  } finally {
    try {
      process.kill(-leader.pid!, "SIGKILL");
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
    }
    s.close();
  }
});

test("un permiso denegado o un registro de conexión inválido impide descartar sin filtrar credenciales", (t) => {
  const s = fixture();
  try {
    s.run.process = { pid: 123, version: "test", configuration: {} };
    const kill = t.mock.method(process, "kill", () => {
      throw Object.assign(new Error("Denied"), { code: "EPERM" });
    });
    assert.throws(
      () => assertRunProcessesStopped(s.config.dataDir, s.run),
      /No se pudo comprobar/,
    );
    kill.mock.restore();
    s.run.process = null;
    const directory = join(s.config.dataDir, "conversations", s.run.id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "connection.json"),
      '{"password":"private-test-password"',
    );
    assert.throws(
      () => discardExecution(s.config, s.run.id),
      (error) =>
        error instanceof Error &&
        /conexión local/.test(error.message) &&
        !error.message.includes("private-test-password"),
    );
    assert.equal(s.read().status, "intervention");
  } finally {
    s.close();
  }
});

test("no descarta una identidad ausente, inválida, finalizada o de otro proyecto", () => {
  const s = fixture("completed");
  try {
    assert.throws(() => discardExecution(s.config, ""), /--id/);
    assert.throws(
      () => discardExecution(s.config, "../connection.json"),
      /--id/,
    );
    assert.throws(
      () => discardExecution(s.config, "00000000-0000-0000-0000-000000000000"),
      /No se encontró/,
    );
    assert.throws(
      () => discardExecution(s.config, s.run.id),
      /ya está finalizada/,
    );
    s.run.status = "intervention";
    s.run.request = {
      ...s.ready(),
      capturedAt: Date.now(),
      configuration: s.config.managedProject,
      runtime: s.config,
    };
    s.run.request.repository = "another/project";
    const store = new Store(s.config.dataDir);
    store.save(s.run);
    store.close();
    assert.throws(
      () => discardExecution(s.config, s.run.id),
      /otro Managed project/,
    );
  } finally {
    s.close();
  }
});

test("al arrancar, el descarte no publica etiquetas ni respuestas antiguas, admite otro issue y conserva la deduplicación hasta borrar", async () => {
  const s = fixture();
  const requests: string[] = [];
  const store = new Store(s.config.dataDir);
  s.run.request = {
    ...s.ready(),
    capturedAt: Date.now(),
    configuration: s.config.managedProject,
    runtime: s.config,
  };
  s.run.recovery = {
    consumed: [],
    response: { commentId: "old", body: "Do not publish" },
  };
  store.save(s.run);
  store.close();
  discardExecution(s.config, s.run.id);
  const workflow = createWorkflow(s.config, {
    createAgent: () => s.agent,
    github: {
      async ready() {
        return [s.ready()];
      },
      async setRunLabel(_repository, issue) {
        requests.push(`label:${issue}`);
      },
    },
    issueConversation: {
      async comments() {
        requests.push("comments");
        return [];
      },
      async comment() {
        throw new Error("Discarded run must not publish");
      },
      async close() {
        throw new Error("Discarded run must not close issue");
      },
    },
    workspace: {
      async prepare(id) {
        return {
          directory: join(s.config.dataDir, "workspaces", id),
          branch: "issue-2",
          baseSha: "a".repeat(40),
          instructions: [],
        };
      },
      async validate() {},
    },
  });
  try {
    await workflow.poll();
    assert.deepEqual(requests, []);
    assert.equal(workflow.factory.active, null);
    assert.equal(workflow.list().length, 1);
    const before = workflow.view(s.run.id)!;
    assert.equal(before.recovery?.response?.body, "Do not publish");
    await workflow.observe([s.ready(2)]);
    const next = (await workflow.startNext())!;
    assert.equal(next.status, "running", next.error ?? "");
    assert.equal(next.request?.number, 2);
    assert.equal(s.tasks.length, 1);
    assert.equal(workflow.view(s.run.id)?.stopReason, "discarded");
    await workflow.stop(next.id);
    requests.length = 0;
    workflow.deleteRun(s.run.id);
    await workflow.observe([s.ready()]);
    assert.equal(workflow.queue().length, 1);
    assert.notEqual(workflow.queue()[0].id, s.run.id);
    assert.deepEqual(requests, ["label:1"]);
  } finally {
    workflow.close();
    s.close();
  }
});

test("la CLI descarta offline sin credenciales ni recuperación de configuración y rechaza --id ausente", () => {
  const s = fixture();
  try {
    mkdirSync(s.config.projectDir, { recursive: true });
    const projectFile = join(s.root, "project.json");
    writeFileSync(projectFile, JSON.stringify(s.config.managedProject));
    const configFile = join(s.root, "factory.json");
    writeFileSync(
      configFile,
      JSON.stringify({
        ...s.config,
        managedProjectFile: projectFile,
        opencodeCli: "/nonexistent/opencode",
        model: "another-model",
      }),
    );
    const execute = (...args: string[]) =>
      spawnSync(
        process.execPath,
        [resolve("src/cli.ts"), "discard", "--config", configFile, ...args],
        {
          env: { HOME: s.root, PATH: process.env.PATH },
          encoding: "utf8",
          timeout: 5000,
        },
      );
    const missing = execute();
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /--id/);
    const result = execute("--id", s.run.id);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Puesto liberado/);
    assert.ok(result.stdout.includes(s.run.id));
    assert.equal(s.read().stopReason, "discarded");
    assert.equal(existsSync(join(s.config.dataDir, "conversations")), false);
    assert.ok(readFileSync(configFile, "utf8").includes("another-model"));
  } finally {
    s.close();
  }
});
