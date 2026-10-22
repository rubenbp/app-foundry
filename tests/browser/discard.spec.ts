import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { createFactory } from "../../src/composition/factory.ts";
import { discardExecution } from "../../src/composition/discard.ts";
import { createWorkflow } from "../../src/composition/workflow.ts";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import { verificationPlan } from "../../src/domain/verification.ts";
import { setup } from "../support/admission.ts";

test("el Dashboard permite copiar el ID completo y muestra el puesto liberado tras descartar, conservando errores como evidencia", async ({
  page,
}) => {
  const s = setup();
  const factory = createFactory(s.config, s.agent);
  const run = factory.enqueue("Prueba descartada");
  run.status = "intervention";
  run.phase = "verification";
  run.error = "Fallo anterior conservado";
  run.pending = [
    { id: "old-question", kind: "question", text: "Pregunta anterior" },
  ];
  run.verification = verificationPlan("a".repeat(40), [], "Criteria");
  run.verification.effectsUncertain = true;
  factory.persist(run);
  factory.close();
  discardExecution(s.config, run.id);
  const workflow = createWorkflow(s.config, { createAgent: () => s.agent });
  const server = panelServer(workflow.factory, undefined, workflow);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await page.goto(origin);
    await expect(page.locator(".dashboard-status")).toHaveText("Descartada");
    await expect(
      page.getByText("Puesto liberado", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("El puesto sigue reservado", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("REQUIERE TU ATENCIÓN", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Configuración, procesos y evidencia" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", {
        name: "Evidencia y detalles de la ejecución",
      }),
    ).toBeVisible();
    const row = dialog
      .getByText("ID de la ejecución", { exact: true })
      .locator("..");
    const id = row.locator("code");
    await expect(id).toHaveText(run.id);
    await expect(id).toBeVisible();
    await expect(
      dialog.getByText("Interrumpida por descarte", { exact: true }),
    ).toBeVisible();
    await id.selectText();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
      run.id,
    );
    await page.screenshot({
      path: test.info().outputPath("execution-id-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(id).toBeVisible();
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("execution-id-mobile.png"),
    });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    expect(workflow.view(run.id)?.error).toBe("Fallo anterior conservado");
    await page
      .getByRole("button", { name: "Eliminar ejecución", exact: true })
      .click();
    const deletion = page.getByRole("dialog", { name: "Eliminar ejecución" });
    await deletion
      .getByRole("button", { name: "Eliminar", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Todo empieza con una petición" }),
    ).toBeVisible();
    expect(workflow.view(run.id)).toBeNull();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    workflow.close();
    rmSync(s.root, { recursive: true, force: true });
  }
});
