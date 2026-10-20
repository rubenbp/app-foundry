import { test, expect } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createWorkflow } from "../../src/composition/workflow.ts";
import type { Workflow } from "../../src/application/workflow.ts";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import type { Fact } from "../../src/application/agent.ts";

test("el dashboard sigue una Petición en cola durante la preparación de la base, la implementación y la intervención de GitHub", async ({
  page,
}) => {
  const root = mkdtempSync(join(tmpdir(), "foundry-queue-panel-"));
  let emit: (fact: Fact) => void = () => {};
  let release!: () => void;
  const preparing = new Promise<void>((resolve) => {
    release = resolve;
  });
  const project = {
    id: "catalogue",
    repository: `team/panel-${root.split("-").at(-1)}`,
    baseBranch: "develop",
    instructions: ["README.md"],
    preparation: { command: "npm ci" },
    verification: { commands: ["npm test"] },
    publication: {
      provider: "vercel" as const,
      projectId: "panel-project",
      humanMergeRequired: true as const,
    },
  };
  const workflow = createWorkflow(
    {
      dataDir: root,
      projectDir: root + "/probe",
      provider: "openai",
      model: "gpt-6-luna",
      auth: "opencode",
      managedProject: project,
    },
    {
      createAgent: () => ({
        async start(sink) {
          emit = sink;
          return { pid: 123, version: "test", configuration: {} };
        },
        async resume() {},
        async create() {
          return "s1";
        },
        async send() {},
        async stop() {
          return { exited: true, detail: "Stopped" };
        },
      }),
      workspace: {
        async prepare(id, _project, effect) {
          const workspace = {
            directory: `${root}/workspaces/${id}`,
            branch: `codex/execution-${id}`,
            baseSha: "a".repeat(40),
            instructions: [{ path: "README.md", text: "Accessible catalogue" }],
          };
          await effect("base-context", "Capture base", async () => ({
            workspace,
            label: "Base captured",
            output: workspace.baseSha,
          }));
          await preparing;
          return workspace;
        },
        async validate() {},
      },
    },
  );
  const issue = (number: number) => ({
    repository: project.repository,
    number,
    title: `Catálogo ${number}`,
    body: "## Acceptance criteria\nMostrar todos los juegos y conservar el teclado.",
    author: "owner",
    url: `https://github.com/${project.repository}/issues/${number}`,
  });
  await workflow.observe([issue(1), issue(2)]);
  const server = panelServer(workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let started: ReturnType<Workflow["startNext"]> | undefined;
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    await expect(
      page.getByRole("heading", { name: "Cola de peticiones" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Cola de peticiones" })
        .getByRole("listitem"),
    ).toHaveCount(2);
    await page
      .getByRole("link", { name: "Encargo y criterios", exact: true })
      .click();
    await expect(
      page.getByText("Mostrar todos los juegos y conservar el teclado.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByText("owner", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cerrar diálogo" }).click();
    started = workflow.startNext();
    await expect(page.locator(".badge.preparing")).toHaveText(
      "Preparando base",
    );
    await page
      .getByRole("button", { name: "Código de la Ejecución", exact: true })
      .click();
    await page
      .getByText(
        "Identificadores completos, configuración e instrucciones capturadas",
        { exact: true },
      )
      .click();
    await expect(
      page.getByText("a".repeat(40), { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cerrar diálogo" }).click();
    release();
    await started;
    await expect(
      page
        .getByRole("navigation", { name: "Fases de la Ejecución" })
        .getByRole("listitem")
        .filter({ hasText: "Implementación" }),
    ).toHaveAttribute("aria-current", "step");
    await expect(
      page
        .getByRole("region", { name: "Cola de peticiones" })
        .getByRole("listitem"),
    ).toHaveCount(1);
    await page.screenshot({
      path: test.info().outputPath("admission-panel.png"),
      fullPage: true,
    });
    emit({ type: "error", text: "Falta decisión sobre el catálogo" });
    await expect(page.locator(".notice.danger")).toContainText(
      "Falta decisión sobre el catálogo",
    );
    await expect(
      page.getByRole("link", { name: "Registrar la intervención en GitHub" }),
    ).toHaveAttribute("href", issue(1).url);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    release();
    await started;
    server.closeAllConnections();
    server.close();
    workflow.close();
  }
});
