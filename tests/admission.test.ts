import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createWorkflow } from "../src/composition/workflow.ts";
import { project, setup } from "./support/admission.ts";

test("un issue con factory:ready se captura una sola vez, incluso si cambia, se quita la etiqueta o se reinicia", async () => {
  const s = setup();
  let workflow = createWorkflow(s.config, { createAgent: () => s.agent });
  try {
    const request = s.ready();
    await workflow.observe([request]);
    const admitted = workflow.list()[0];
    assert.equal(admitted.status, "queued");
    assert.equal(admitted.request?.body, request.body);
    request.body = "Changed after admission";
    await workflow.observe([request]);
    await workflow.observe([]);
    assert.equal(workflow.list().length, 1);
    assert.equal(workflow.view(admitted.id)?.request?.body, s.ready().body);
    workflow.close();
    workflow = createWorkflow(s.config, { createAgent: () => s.agent });
    await workflow.observe([s.ready()]);
    assert.equal(workflow.list().length, 1);
    assert.equal(workflow.list()[0].status, "queued");
  } finally {
    workflow.close();
  }
});

test("la admisión acepta contenido vacío o incompleto sin acreditar actores ni criterios", async () => {
  const s = setup();
  const workflow = createWorkflow(s.config, { createAgent: () => s.agent });
  try {
    await workflow.observe([
      { ...s.ready(1), title: "", body: "" },
      { ...s.ready(2), body: " " },
      { ...s.ready(3), body: "Quiero mejorar el catálogo." },
    ]);
    assert.equal(workflow.list().length, 3);
    assert.equal(workflow.observation.error, null);
    assert.equal(workflow.queue()[0].request?.body, "");
    assert.equal(s.tasks.length, 0);
  } finally {
    workflow.close();
  }
});

test("un Managed project excluye un segundo Workflow, incluso con otra raíz de datos", () => {
  const s = setup();
  const workflow = createWorkflow(s.config, { createAgent: () => s.agent });
  try {
    assert.throws(
      () =>
        createWorkflow(
          { ...s.config, dataDir: join(s.root, "second") },
          { createAgent: () => s.agent },
        ),
      /Another Factory/,
    );
  } finally {
    workflow.close();
  }
});

test("la cola sigue la primera observación y desempata de forma estable por issue", async () => {
  const s = setup();
  const workflow = createWorkflow(s.config, { createAgent: () => s.agent });
  try {
    workflow.factory.now = () => 1000;
    await workflow.observe([s.ready(9), s.ready(2)]);
    workflow.factory.now = () => 2000;
    await workflow.observe([s.ready(1)]);
    assert.deepEqual(
      workflow.queue().map((r) => r.request?.number),
      [2, 9, 1],
    );
    assert.equal(s.tasks.length, 0);
  } finally {
    workflow.close();
  }
});

test("la configuración del proyecto incompleta o no confiable se rechaza antes de crear un agente", () => {
  const s = setup();
  let started = false;
  assert.throws(
    () =>
      createWorkflow(
        {
          ...s.config,
          managedProject: {
            ...project,
            repository: "../other",
            verification: { commands: [] },
          },
        },
        {
          createAgent: () => {
            started = true;
            return s.agent;
          },
        },
      ),
    /configuration|repository/i,
  );
  assert.equal(started, false);
});

test("el Issue autorizado conserva la configuración de agente elegida mientras espera en la cola", async () => {
  const s = setup();
  const workflow = createWorkflow(
    { ...s.config, opencodeCli: "/trusted/opencode" },
    { createAgent: () => s.agent },
  );
  try {
    await workflow.observe([s.ready()]);
    assert.deepEqual(workflow.list()[0].request?.runtime, {
      provider: "openai",
      model: "gpt-6-luna",
      auth: "opencode",
      opencodeCli: "/trusted/opencode",
    });
  } finally {
    workflow.close();
  }
});

test("un issue ajeno al Managed project no bloquea otros issues de la misma observación", async () => {
  const s = setup();
  const workflow = createWorkflow(s.config, { createAgent: () => s.agent });
  try {
    await workflow.observe([
      {
        ...s.ready(9),
        repository: "another/repository",
      },
      s.ready(2),
    ]);
    assert.equal(workflow.list()[0]?.request?.number, 2);
    assert.match(workflow.observation.error!, /configured Managed project/);
  } finally {
    workflow.close();
  }
});

test("el historial anterior sigue en cola sin depender de la acreditación guardada ni readmitir el issue", async () => {
  const s = setup();
  let workflow = createWorkflow(s.config, { createAgent: () => s.agent });
  try {
    await workflow.observe([s.ready(9), s.ready(2)]);
    for (const run of workflow.list()) {
      workflow.factory.store.save({
        ...run,
        request: Object.assign({}, run.request, {
          updatedAt: "2026-10-17T10:00:00Z",
          authorization: {
            id: `legacy-${run.request!.number}`,
            actor: "legacy-writer",
            at:
              run.request!.number === 9
                ? "2026-10-15T10:00:00Z"
                : "2026-10-17T10:00:00Z",
            canWrite: true,
            contentUnchanged: true,
          },
          contentHash: "legacy-content-hash",
        }),
      });
    }
    workflow.close();
    workflow = createWorkflow(s.config, { createAgent: () => s.agent });
    await workflow.observe([s.ready(9), s.ready(2)]);
    assert.equal(workflow.list().length, 2);
    assert.deepEqual(
      workflow.queue().map((run) => run.request?.number),
      [2, 9],
    );
    assert.equal(workflow.queue()[0].request?.body, s.ready().body);
    assert.equal(workflow.observation.error, null);
  } finally {
    workflow.close();
  }
});
