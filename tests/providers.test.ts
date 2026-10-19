import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../src/infrastructure/configuration.ts";
import { exportCredential } from "../src/infrastructure/opencode/credentials.ts";
import { createWorkflow } from "../src/composition/workflow.ts";
import { createFactory } from "../src/composition/factory.ts";
import type { RunStatus } from "../src/domain/run.ts";
import type { FactoryConfig } from "../src/application/configuration.ts";
import { acquireWorkflowOwnership } from "../src/infrastructure/ownership.ts";
import { setup } from "./support/admission.ts";

test("la configuración admite modelos sin lista manual y exige CLI solo para proveedores remotos", () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-provider-config-"));
  mkdirSync(join(root, "project"));
  const file = join(root, "config.json");
  const config = {
    dataDir: join(root, "data"),
    projectDir: join(root, "project"),
    auth: "opencode",
    provider: "ollama",
    model: "my-coder:custom",
  };
  const read = (overrides = {}) => {
    writeFileSync(file, JSON.stringify({ ...config, ...overrides }));
    return readConfig(file);
  };
  try {
    assert.equal(read().model, "my-coder:custom");
    for (const provider of ["google", "anthropic", "openai"]) {
      assert.throws(() => read({ provider }), /opencodeCli/);
      assert.equal(
        read({
          provider,
          model: "future-model",
          opencodeCli: "/trusted/opencode",
        }).model,
        "future-model",
      );
    }
    assert.throws(() => read({ provider: "unknown" }), /Supported providers/);
    for (const model of ["", " ", "coder#low", "coder\nother"]) {
      assert.throws(() => read({ model }), /model/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("la exportación selecciona únicamente la clave activa del proveedor y la registra para saneamiento", () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-provider-auth-"));
  const cli = join(root, "opencode");
  const secret = "fictional-api-secret";
  try {
    for (const provider of ["google", "anthropic"]) {
      const entries = [
        {
          active: true,
          integrationID: "unrelated",
          value: { type: "key", key: "wrong-provider" },
        },
        {
          active: false,
          integrationID: provider,
          value: { type: "key", key: "inactive" },
        },
        {
          active: true,
          integrationID: provider,
          value: { type: "key", key: secret },
        },
      ];
      writeFileSync(
        cli,
        `#!${process.execPath}\nif (process.argv.slice(2).join(' ') !== 'auth export ${provider}') process.exit(1);\nconsole.log(${JSON.stringify(JSON.stringify(entries))});`,
        { mode: 0o700 },
      );
      const protectedValues: string[] = [];
      const result = exportCredential(cli, provider, (values) =>
        protectedValues.push(...values),
      );
      assert.deepEqual(result, {
        integrationID: provider,
        value: { type: "key", key: secret },
      });
      assert.deepEqual(protectedValues, [secret]);
    }
    for (const output of [
      secret,
      JSON.stringify([
        { active: true, integrationID: "google", value: { type: "key" } },
      ]),
    ]) {
      writeFileSync(
        cli,
        `#!${process.execPath}\nconsole.log(${JSON.stringify(output)});`,
        { mode: 0o700 },
      );
      assert.throws(
        () => exportCredential(cli, "google", () => {}),
        (error: unknown) =>
          error instanceof Error && !error.message.includes(secret),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("el arranque rechaza otra selección en todas las fases iniciadas sin modificar la evidencia", async () => {
  const statuses: RunStatus[] = [
    "preparing",
    "starting",
    "running",
    "waiting",
    "intervention",
    "awaiting_verification",
    "verifying",
    "awaiting_preview",
    "awaiting_review",
    "closing_issue",
    "queued",
  ];
  for (const status of statuses) {
    const s = setup();
    const workflow = createWorkflow(s.config, { createAgent: () => s.agent });
    await workflow.observe([s.ready()]);
    const run = workflow.list()[0];
    run.status = status;
    run.phase = "preparation";
    workflow.factory.persist(run);
    workflow.close();
    for (const change of [
      { provider: "google" },
      { model: "different-model" },
    ]) {
      assert.throws(
        () =>
          createWorkflow(
            { ...s.config, ...change },
            { createAgent: () => s.agent },
          ),
        /No se puede arrancar.*Ejecución/,
      );
    }
    const unchanged = createFactory(s.config, s.agent);
    assert.equal(
      unchanged.list()[0].history.filter((item) => item.kind === "recovery")
        .length,
      status === "queued" ? 0 : 1,
    );
    unchanged.close();
  }
});

test("una reserva interrumpida antes de preparar también impide cambiar proveedor/modelo", async () => {
  const s = setup();
  const workflow = createWorkflow(s.config, { createAgent: () => s.agent });
  await workflow.observe([s.ready()]);
  const id = workflow.list()[0].id;
  workflow.close();
  const ownership = acquireWorkflowOwnership(s.config);
  ownership.reserve(id);
  ownership.close();
  assert.throws(
    () =>
      createWorkflow(
        { ...s.config, provider: "google" },
        { createAgent: () => s.agent },
      ),
    /No se puede arrancar/,
  );
  const restored = createWorkflow(s.config, { createAgent: () => s.agent });
  try {
    assert.equal(restored.view(id)?.status, "intervention");
    await restored.stop(id);
  } finally {
    restored.close();
  }
});

test("la cola nunca iniciada adopta la selección global al empezar y el historial terminado no bloquea", async () => {
  const s = setup();
  let workflow = createWorkflow(s.config, { createAgent: () => s.agent });
  const selections: FactoryConfig[] = [];
  try {
    await workflow.observe([s.ready(1), s.ready(2), s.ready(3)]);
    for (const [index, status] of ["completed", "stopped"].entries()) {
      const run = workflow.list()[index];
      run.status = status === "completed" ? "completed" : "stopped";
      run.phase = "implementation";
      workflow.factory.persist(run);
    }
    workflow.close();
    const config = {
      ...s.config,
      provider: "google",
      model: "a-new-model",
      opencodeCli: "/new/opencode",
    };
    workflow = createWorkflow(config, {
      createAgent: (selection) => {
        selections.push(selection);
        return s.agent;
      },
      workspace: {
        async prepare() {
          return {
            directory: s.root,
            branch: "work",
            baseSha: "base",
            instructions: [],
          };
        },
        async validate() {},
      },
    });
    const started = await workflow.startNext();
    assert.equal(started?.status, "running", started?.error ?? "");
    assert.equal(started.request?.runtime.provider, "google");
    assert.equal(started.request?.runtime.model, "a-new-model");
    assert.equal(selections.at(-1)?.provider, "google");
    assert.equal(selections.at(-1)?.model, "a-new-model");
    await workflow.stop(started.id);
  } finally {
    workflow.close();
  }
});

test("una Ejecución manual también conserva su selección al reiniciar", async () => {
  const s = setup();
  const factory = createFactory(s.config, s.agent);
  const run = await factory.run("Bounded manual task");
  factory.close();
  assert.throws(
    () => createFactory({ ...s.config, model: "different" }, s.agent),
    /No se puede arrancar/,
  );
  const restored = createFactory(s.config, s.agent);
  try {
    await restored.stop(run.id);
  } finally {
    restored.close();
  }
});
