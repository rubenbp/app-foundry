import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import { publicationFixture } from "../support/publication.ts";

test("el dashboard guía la revisión con la PR y preview y permite consultar la evidencia técnica local", async ({
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
    await page
      .getByRole("button", { name: "Configuración, procesos y evidencia" })
      .click();
    const section = page.getByRole("region", { name: "Preview y aceptación" });
    await section
      .getByText("Detalles de publicación e historial", { exact: true })
      .click();
    await expect(section).toContainText(s.facts.pull!.head);
    await expect(section).toContainText(
      "deployment-1 · Preview · Deployment correcto",
    );
    await expect(section).toContainText("Autorizado y comprobado");
    await expect(section).toContainText("Sin aceptación registrada");
    const report = section.getByRole("link", {
      name: "Ver evidencia técnica",
    });
    await expect(report).toHaveAttribute("href", "#verification-title");
    await report.focus();
    await expect(report).toBeFocused();
    await report.click();
    const verification = page.getByRole("region", {
      name: "Verificación independiente",
    });
    await expect(verification).toBeInViewport();
    await page
      .locator('button[aria-controls="output-verification-check-1"]')
      .click();
    await expect(page.locator("#output-verification-check-1")).toContainText(
      "catalogue checked",
    );
    await verification
      .getByText("Alcance, limitaciones y registro de evidencia", {
        exact: true,
      })
      .click();
    for (const limitation of s.workflow.view(run.id)!.verification!
      .limitations) {
      await expect(verification).toContainText(limitation);
    }
    for (const criterion of s.workflow.view(run.id)!.verification!.criteria) {
      for (const missing of criterion.missing) {
        await expect(verification).toContainText(missing);
      }
    }
    await expect(
      section.getByRole("link", { name: /informe.*GitHub/ }),
    ).toHaveCount(0);
    await expect(
      section.getByRole("link", { name: "Abrir preview" }),
    ).toHaveAttribute("href", s.facts.preview!.url!);
    await s.workflow.poll();
    await expect(page.locator(".dashboard-status")).toHaveText(
      "Esperando revisión y merge humano",
    );
    await expect(section).toContainText("Sin aceptación registrada");
    await expect(section).toContainText("Sin aceptación vigente");
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
    await expect(section).toContainText("Deployment correcto");
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
    await expect(page.locator(".dashboard-status")).toHaveText("Completada");
    await expect(
      page.getByRole("navigation", { name: "Fases de la Ejecución" }),
    ).toContainText("Cierre");
    await expect(page.getByText("Producción", { exact: true })).toHaveCount(0);
    await page
      .getByRole("button", { name: "Configuración, procesos y evidencia" })
      .click();
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
    await page
      .getByRole("button", { name: "Configuración, procesos y evidencia" })
      .click();
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
