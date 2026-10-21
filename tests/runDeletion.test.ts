import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { request } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { RunStatus } from "../src/domain/run.ts";
import { createFactory } from "../src/composition/factory.ts";
import { RunDeletionRejected } from "../src/application/runDeletion.ts";
import { artifactPath } from "../src/infrastructure/persistence/artifactPath.ts";
import { panelServer } from "../src/infrastructure/http/panelServer.ts";
import { setup } from "./support/admission.ts";
import { publicationFixture } from "./support/publication.ts";

for (const status of ["completed", "stopped"] as const) {
  test(`eliminar una Ejecución ${status} borra solo sus datos locales y sigue ausente tras reiniciar`, () => {
    const s = setup();
    let factory = createFactory(s.config, s.agent);
    try {
      const run = factory.enqueue("Discard local execution");
      run.status = status;
      run.parts = [
        {
          id: "output",
          messageId: "message",
          kind: "text",
          label: "Output",
          updatedAt: 1,
          truncated: false,
        },
      ];
      factory.persist(run);
      factory.store.write(run.id, "output", "Owned evidence");
      const other = factory.enqueue("Keep another execution");
      factory.store.write(other.id, "output", "Other evidence");
      factory.store.observation({ at: 123, error: null });
      for (const name of ["workspaces", "conversations"]) {
        for (const id of [run.id, other.id]) {
          mkdirSync(join(s.config.dataDir, name, id), { recursive: true });
          writeFileSync(
            join(s.config.dataDir, name, id, "manual.txt"),
            "Manual changes",
          );
        }
      }
      mkdirSync(s.config.projectDir, { recursive: true });
      writeFileSync(
        join(s.config.projectDir, "integrated.txt"),
        "Integrated code",
      );
      const temporary =
        artifactPath(s.config.dataDir, run.id, "output") + ".tmp";
      writeFileSync(temporary, "Interrupted write");

      factory.deleteRun(run.id);
      assert.equal(factory.view(run.id), null);
      assert.equal(factory.output(run.id, "output"), null);
      assert.equal(existsSync(temporary), false);
      for (const name of ["workspaces", "conversations"]) {
        assert.equal(existsSync(join(s.config.dataDir, name, run.id)), false);
        assert.equal(
          readFileSync(
            join(s.config.dataDir, name, other.id, "manual.txt"),
            "utf8",
          ),
          "Manual changes",
        );
      }
      assert.equal(
        readFileSync(join(s.config.projectDir, "integrated.txt"), "utf8"),
        "Integrated code",
      );
      assert.equal(factory.output(other.id, "output"), "Other evidence");
      assert.deepEqual(factory.store.observation(), {
        at: 123,
        error: null,
        lastSuccess: 123,
      });
      factory.close();
      factory = createFactory(s.config, s.agent);
      assert.equal(factory.view(run.id), null);
      assert.ok(factory.view(other.id));
    } finally {
      factory.close();
      rmSync(s.root, { recursive: true, force: true });
    }
  });
}

test("un fallo parcial conserva el registro y permite repetir la limpieza con archivos ya ausentes", () => {
  const s = setup();
  const factory = createFactory(s.config, s.agent);
  try {
    const run = factory.enqueue("Cleanup retry");
    run.status = "stopped";
    run.parts = [
      {
        id: "output",
        messageId: "m",
        kind: "text",
        label: "Output",
        updatedAt: 1,
        truncated: false,
      },
    ];
    factory.persist(run);
    factory.store.write(run.id, "output", "Evidence");
    mkdirSync(join(s.config.dataDir, "workspaces", run.id), {
      recursive: true,
    });
    const blocked = artifactPath(s.config.dataDir, run.id, "output") + ".tmp";
    mkdirSync(blocked);
    assert.throws(() => factory.deleteRun(run.id));
    assert.equal(factory.view(run.id)?.status, "stopped");
    assert.equal(
      existsSync(join(s.config.dataDir, "workspaces", run.id)),
      false,
    );
    assert.equal(factory.store.failed, false);
    rmSync(blocked, { recursive: true });
    factory.deleteRun(run.id);
    assert.equal(factory.view(run.id), null);
  } finally {
    factory.close();
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("el borrado rechaza todos los estados pendientes aunque tengan endedAt", () => {
  const s = setup();
  const factory = createFactory(s.config, s.agent);
  try {
    const statuses: RunStatus[] = [
      "queued",
      "preparing",
      "starting",
      "running",
      "waiting",
      "awaiting_verification",
      "verifying",
      "awaiting_preview",
      "awaiting_review",
      "closing_issue",
      "intervention",
    ];
    for (const status of statuses) {
      const run = factory.enqueue(status);
      run.status = status;
      run.endedAt = 123;
      factory.persist(run);
      factory.store.write(run.id, "output", "Keep evidence");
      assert.throws(
        () => factory.deleteRun(run.id),
        (error) =>
          error instanceof RunDeletionRejected && error.reason === "unfinished",
      );
      assert.equal(factory.output(run.id, "output"), "Keep evidence");
      assert.equal(factory.view(run.id)?.status, status);
    }
  } finally {
    factory.close();
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("la limpieza rechaza padres simbólicos y nunca usa rutas externas guardadas en la Ejecución", () => {
  const s = setup();
  const factory = createFactory(s.config, s.agent);
  try {
    const run = factory.enqueue("Owned paths only");
    run.status = "stopped";
    run.workspace = {
      directory: s.config.projectDir,
      branch: "main",
      baseSha: "a".repeat(40),
      instructions: [],
    };
    factory.persist(run);
    mkdirSync(s.config.projectDir, { recursive: true });
    writeFileSync(join(s.config.projectDir, "keep.txt"), "Keep");
    const parent = join(s.config.dataDir, "workspaces");
    symlinkSync(s.config.projectDir, parent);
    assert.throws(() => factory.deleteRun(run.id), /owned directory/);
    assert.ok(factory.view(run.id));
    rmSync(parent);
    mkdirSync(parent);
    symlinkSync(s.config.projectDir, join(parent, run.id));
    factory.deleteRun(run.id);
    assert.equal(
      readFileSync(join(s.config.projectDir, "keep.txt"), "utf8"),
      "Keep",
    );
  } finally {
    factory.close();
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("el workflow bloquea el borrado durante una etiqueta en vuelo y no toca GitHub al eliminar", async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let pause = false;
  let writes = 0;
  const s = publicationFixture({
    github: {
      async ready() {
        return [];
      },
      async setRunLabel() {
        writes++;
        if (pause) {
          entered();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
      },
    },
  });
  try {
    const run = await s.start();
    await s.workflow.stop(run.id);
    const terminal = s.workflow.view(run.id)!;
    delete terminal.issueLabel;
    s.workflow.factory.persist(terminal);
    pause = true;
    const syncing = s.workflow.syncIssueLabels();
    await started;
    assert.throws(
      () => s.workflow.deleteRun(run.id),
      (error) =>
        error instanceof RunDeletionRejected && error.reason === "busy",
    );
    release();
    await syncing;
    const before = writes;
    const remote = structuredClone(s.facts);
    s.workflow.deleteRun(run.id);
    assert.equal(writes, before);
    assert.deepEqual(s.facts, remote);
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id), null);
    s.emit({
      type: "part",
      id: "late",
      messageId: "late",
      kind: "text",
      text: "Late event",
    });
    assert.equal(s.workflow.view(run.id), null);
    assert.equal(readdirSync(join(s.config.dataDir, "artifacts")).length, 0);
    s.reopen();
    assert.equal(s.workflow.view(run.id), null);
    pause = false;
    await s.workflow.observe([terminal.request!]);
    const readmitted = s.workflow
      .list()
      .find((item) => item.request?.number === terminal.request!.number);
    assert.ok(readmitted);
    assert.notEqual(readmitted.id, run.id);
    assert.equal(readmitted.status, "queued");
  } finally {
    s.close();
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("eliminar una Ejecución integrada no modifica el issue, la PR ni los deployments", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.merge();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "completed");
    const remote = structuredClone(s.facts);
    const writes = s.writes.length;
    const server = panelServer(s.workflow.factory, undefined, s.workflow);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      assert.equal(
        (
          await fetch(`${origin}/api/runs/${run.id}`, {
            method: "DELETE",
            headers: { Origin: origin },
          })
        ).status,
        204,
      );
      assert.equal(s.workflow.view(run.id), null);
      assert.equal(s.writes.length, writes);
      assert.deepEqual(s.facts, remote);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    s.reopen();
    assert.equal(s.workflow.view(run.id), null);
    assert.equal(s.workflow.factory.active, null);
  } finally {
    s.close();
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("DELETE exige el mismo origen, rechaza ejecuciones pendientes y elimina solo la solicitada", async () => {
  const s = setup();
  const factory = createFactory(s.config, s.agent);
  const server = panelServer(factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const run = factory.enqueue("HTTP deletion");
  const url = `${origin}/api/runs/${run.id}`;
  try {
    const rejectedHeaders: Record<string, string>[] = [
      {},
      { Origin: "https://external.example" },
      { Origin: origin, "Sec-Fetch-Site": "cross-site" },
    ];
    for (const headers of rejectedHeaders) {
      assert.equal(
        (await fetch(url, { method: "DELETE", headers })).status,
        403,
        JSON.stringify(headers),
      );
    }
    const invalidHost = await new Promise<number | undefined>(
      (resolve, reject) => {
        const req = request(
          url,
          { method: "DELETE", headers: { Origin: origin, Host: "localhost" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    assert.equal(invalidHost, 403);
    assert.equal(
      (await fetch(url, { method: "DELETE", headers: { Origin: origin } }))
        .status,
      409,
    );
    run.status = "stopped";
    factory.persist(run);
    assert.equal(
      (await fetch(url, { method: "DELETE", headers: { Origin: origin } }))
        .status,
      204,
    );
    assert.equal(factory.view(run.id), null);
    assert.equal(
      (await fetch(url, { method: "DELETE", headers: { Origin: origin } }))
        .status,
      404,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/view`, {
          method: "POST",
          headers: { Origin: origin },
        })
      ).status,
      405,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    factory.close();
    rmSync(s.root, { recursive: true, force: true });
  }
});
