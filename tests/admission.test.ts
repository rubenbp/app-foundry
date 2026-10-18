import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkflow } from "../src/composition/workflow.ts";
import type { ReadyIssue, ManagedProject } from "../src/domain/request.ts";
import type { AgentPort } from "../src/application/agent.ts";

export const project: ManagedProject = {
  id: "other-product",
  repository: "team/other-product",
  baseBranch: "develop",
  instructions: ["README.md"],
  preparation: { command: "npm ci" },
  verification: { commands: ["npm run check", "npm test"] },
  publication: {
    provider: "vercel",
    projectId: "other-id",
    productionOrigin: "https://other.example",
    humanMergeRequired: true,
  },
};
export function ready(number = 1): ReadyIssue {
  return {
    repository: project.repository,
    number,
    title: "Show the catalogue",
    body: "## Acceptance criteria\n- Show every game.\n- Keep keyboard navigation.",
    author: "requester",
    url: `https://github.com/${project.repository}/issues/${number}`,
    updatedAt: "2026-10-17T10:00:00Z",
    authorization: {
      id: `label-${number}`,
      actor: "maintainer",
      at: "2026-10-17T10:00:00Z",
      contentUnchanged: true,
      canWrite: true,
    },
  };
}
export function setup() {
  const root = mkdtempSync(join(tmpdir(), "foundry-admission-"));
  const tasks: string[] = [];
  const agent: AgentPort = {
    async start() {
      return { pid: 123, version: "test", configuration: {} };
    },
    async create() {
      return "session";
    },
    async send(_id, task) {
      tasks.push(task);
    },
    async stop() {
      return { exited: true, detail: "No owned process remains" };
    },
  };
  const config = {
    dataDir: join(root, "data"),
    projectDir: join(root, "probe"),
    provider: "openai",
    model: "gpt-6-luna",
    auth: "opencode" as const,
    managedProject: project,
  };

  return { root, config, agent, tasks };
}

test("una persona con permiso de escritura autoriza una Petición fija una sola vez, incluso si se quita la etiqueta o se reinicia", async () => {
  const s = setup();
  let workflow = createWorkflow(s.config, { createAgent: () => s.agent });
  try {
    const request = ready();
    await workflow.observe([request]);
    const admitted = workflow.list()[0];
    assert.equal(admitted.status, "queued");
    assert.equal(admitted.request?.body, request.body);
    assert.equal(admitted.request?.authorization.actor, "maintainer");
    request.body = "Changed after admission";
    await workflow.observe([request]);
    await workflow.observe([]);
    assert.equal(workflow.list().length, 1);
    assert.equal(workflow.view(admitted.id)?.request?.body, ready().body);
    workflow.close();
    workflow = createWorkflow(s.config, { createAgent: () => s.agent });
    await workflow.observe([ready()]);
    assert.equal(workflow.list().length, 1);
    assert.equal(workflow.list()[0].status, "queued");
  } finally {
    workflow.close();
  }
});

test("una autorización ambigua y la falta de permiso efectivo de escritura nunca admiten trabajo", async () => {
  for (const authorization of [
    { ...ready().authorization, canWrite: false },
    { ...ready().authorization, canWrite: null },
    { ...ready().authorization, contentUnchanged: false },
  ]) {
    const s = setup();
    const workflow = createWorkflow(s.config, { createAgent: () => s.agent });
    try {
      await workflow.observe([{ ...ready(), authorization }]);
      assert.equal(workflow.list().length, 0);
      assert.ok(workflow.observation.error);
      assert.equal(s.tasks.length, 0);
    } finally {
      workflow.close();
    }
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

test("la cola sigue el orden observado de autorización y desempata de forma estable por issue", async () => {
  const s = setup();
  const workflow = createWorkflow(s.config, { createAgent: () => s.agent });
  try {
    await workflow.observe([ready(9), ready(2)]);
    assert.deepEqual(
      workflow.queue().map((r) => r.request?.number),
      [2, 9],
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

test("la Petición fija conserva la configuración de agente elegida mientras espera en la cola", async () => {
  const s = setup();
  const workflow = createWorkflow(
    { ...s.config, opencodeCli: "/trusted/opencode" },
    { createAgent: () => s.agent },
  );
  try {
    await workflow.observe([ready()]);
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

test("un issue no autorizado no puede bloquear otras peticiones autorizadas en la misma observación", async () => {
  const s = setup();
  const workflow = createWorkflow(s.config, { createAgent: () => s.agent });
  try {
    await workflow.observe([
      {
        ...ready(9),
        authorization: { ...ready(9).authorization, canWrite: false },
      },
      ready(2),
    ]);
    assert.equal(workflow.list()[0]?.request?.number, 2);
    assert.match(workflow.observation.error!, /write permission/);
  } finally {
    workflow.close();
  }
});
