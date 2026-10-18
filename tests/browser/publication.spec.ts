import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import { publicationFixture } from "../support/publication.ts";

test("el dashboard guía la revisión y la integración humana con enlaces a la PR, el candidato, el despliegue y el informe", async ({
  page,
}) => {
  const s = publicationFixture();
  const run = await s.candidate();
  await s.workflow.poll();
  const server = panelServer(s.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    const section = page.getByRole("region", { name: "Preview y aceptación" });
    await expect(section).toContainText(s.facts.pull!.head);
    await expect(section).toContainText("deployment-1 · Preview · Correcto");
    await expect(section).toContainText("Autorizado y comprobado");
    await expect(section).toContainText("Sin aceptación registrada");
    const report = section.getByRole("link", {
      name: "Revisar informe y evidencia completa en GitHub",
    });
    await expect(report).toHaveAttribute(
      "href",
      s.workflow.view(run.id)!.publication!.report!.url,
    );
    await report.focus();
    await expect(report).toBeFocused();
    await expect(
      section.getByRole("link", { name: "Abrir preview en Vercel" }),
    ).toHaveAttribute("href", s.facts.preview!.url!);
    await s.workflow.poll();
    await expect(page.locator(".badge.awaiting_review")).toHaveText(
      "Esperando revisión y merge humano",
    );
    await expect(section).toContainText("Sin aceptación registrada");
    await expect(section.getByRole("status")).toContainText(
      "Esperando revisión y merge humano en GitHub",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("publication-panel.png"),
      fullPage: true,
    });
    s.observationFails(true);
    await s.workflow.poll();
    await expect(section.getByRole("alert")).toContainText(
      "GitHub unavailable",
    );
    await expect(section).toContainText("Correcto");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    s.close();
  }
});

test("el dashboard distingue el Commit candidato aceptado, la integración y el cierre del issue en el historial completado", async ({
  page,
}) => {
  const s = publicationFixture();
  const run = await s.candidate();
  await s.workflow.poll();
  await s.workflow.poll();
  s.merge();
  await s.workflow.poll();
  const server = panelServer(s.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    await expect(page.locator(".badge.completed")).toHaveText("Completada");
    await expect(
      page.getByRole("region", { name: "Fases de la Ejecución" }),
    ).toContainText("Integración y cierre");
    await expect(page.getByText("Producción", { exact: true })).toHaveCount(0);
    const integration = page.getByRole("region", {
      name: "Integración y cierre",
    });
    await expect(integration).toContainText(s.facts.pull!.head);
    await expect(integration).toContainText("a".repeat(40));
    await expect(integration).toContainText(
      "Integración completada e issue cerrado.",
    );
    await expect(
      integration.getByRole("link", {
        name: "Revisar resumen de integración en GitHub",
      }),
    ).toHaveAttribute(
      "href",
      s.workflow.view(run.id)!.publication!.integrationReport!.url,
    );
    await expect(
      page.getByText("Comprobando producción", { exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(integration).toContainText(
      "Integración completada e issue cerrado.",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("integration-panel.png"),
      fullPage: true,
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    s.close();
  }
});
