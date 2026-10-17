import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { panelServer } from "../../src/server.ts";
import { publicationFixture } from "../support/publication.ts";

test("panel guides review and human merge with PR, candidate, deployment and report links", async ({
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
    await expect(section).toContainText("Sin aceptación vigente");
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
    s.comment();
    await s.workflow.poll();
    await expect(page.locator(".badge.awaiting_merge")).toHaveText(
      "Esperando merge humano",
    );
    await expect(section).toContainText("Aceptación vigente de shared");
    await expect(section.getByRole("status")).toContainText(
      "Esperando merge humano en GitHub",
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
