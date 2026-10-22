import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import { publicationFixture } from "../support/publication.ts";

test("la cronología muestra la espera de preview y el comentario completo en Markdown tras confirmar el envío", async ({
  page,
}) => {
  const s = publicationFixture();
  const summary = [
    "## Resultado del Intento",
    "Se conserva **el catálogo**.",
    "- Navegación con teclado\n- Enlace a la ficha",
    "[Guía de revisión](https://example.com/review)",
    "```js\nconsole.log('catálogo listo');\n```",
    "<script>window.commentExecuted = true</script>",
    "[Enlace inseguro](javascript:alert(1))",
    `${"Texto completo. ".repeat(350)}FINAL DEL COMENTARIO`,
  ].join("\n\n");
  const run = await s.candidate(
    "Footer",
    `feat: catálogo\n\n<factory-summary>\n${summary}\n</factory-summary>`,
  );
  const wait = s.workflow.view(run.id)!.publication!.previewWait!;
  s.workflow.factory.now = () => wait.startedAt + 74_000;
  const server = panelServer(s.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    const timeline = page.locator(".dashboard-entries");
    await expect(timeline).toContainText("Esperando preview · Intento 1");
    await expect(
      timeline.getByRole("button", { name: /Comentario enviado a GitHub/ }),
    ).toHaveCount(0);
    await s.workflow.poll();
    await expect(timeline).toContainText("Preview listo · 74 s");
    const toggle = timeline.getByRole("button", {
      name: /Comentario enviado a GitHub/,
    });
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const comment = timeline.locator(".dashboard-comment");
    await expect(
      comment.getByRole("heading", { name: "Resultado del Intento" }),
    ).toBeVisible();
    await expect(comment.locator("strong")).toHaveText("el catálogo");
    await expect(comment.getByRole("listitem")).toHaveCount(2);
    await expect(comment.locator("pre code")).toHaveText(
      "console.log('catálogo listo');\n",
    );
    await expect(
      comment.getByRole("link", { name: "Guía de revisión" }),
    ).toHaveAttribute("href", "https://example.com/review");
    await expect(
      comment.getByRole("link", { name: /Ver comentario en GitHub/ }),
    ).toHaveAttribute("href", s.facts.comments[0].url);
    await expect(
      comment.getByText("Enlace inseguro", { exact: true }),
    ).not.toHaveAttribute("href", /javascript:/);
    await expect(comment).toContainText("FINAL DEL COMENTARIO");
    await expect(comment).not.toContainText("app-foundry:");
    await expect(comment.locator("script")).toHaveCount(0);
    await s.workflow.poll();
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await comment
      .getByRole("heading", { name: "Resultado del Intento" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath("comment-preview-timeline.png"),
      fullPage: true,
    });
    await page.reload();
    await expect(
      timeline.getByRole("button", { name: /Comentario enviado a GitHub/ }),
    ).toHaveCount(1);
    await expect(timeline).toContainText("Preview listo · 74 s");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    s.close();
  }
});

test("la cronología muestra duración y motivo cuando falla el deployment de preview", async ({
  page,
}) => {
  const s = publicationFixture();
  const run = await s.candidate();
  const wait = s.workflow.view(run.id)!.publication!.previewWait!;
  s.workflow.factory.now = () => wait.startedAt + 85_000;
  s.facts.preview!.state = "failure";
  await s.workflow.poll();
  const server = panelServer(s.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    const timeline = page.locator(".dashboard-entries");
    const toggle = timeline.getByRole("button", {
      name: /Error al comprobar preview · 85 s/,
    });
    await toggle.click();
    await expect(timeline).toContainText(
      "El deployment está en estado «failure»",
    );
    await s.workflow.poll();
    await expect(toggle).toHaveCount(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    s.close();
  }
});

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
      .getByText("Registro de evidencia", { exact: true })
      .click();
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

test("la búsqueda muestra actividad, errores, pausa y próximo intento real, y conserva el inicio al reintentar", async ({
  page,
}) => {
  const { workflowPolling } =
    await import("../../src/infrastructure/workflowPolling.ts");
  const { recoveryConversation } = await import("../support/recovery.ts");
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  const run = await s.candidate();
  const ready = structuredClone(s.facts.preview);
  s.facts.preview = null;
  const startedAt = s.workflow.view(run.id)!.publication!.previewWait!
    .startedAt;
  let now = startedAt + 10_000;
  s.workflow.factory.now = () => now;
  const makePolling = () =>
    workflowPolling(
      () => s.workflow.poll(),
      () => {
        throw new Error("Unexpected polling error");
      },
      {
        now: () => now,
        onSchedule: (schedule) => {
          s.workflow.factory.observationSchedule = schedule;
        },
      },
    );
  let polling = makePolling();
  polling.wake();
  await polling.pending;
  const server = panelServer(s.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    const search = page
      .getByRole("region", { name: "Búsqueda de preview" })
      .first();
    await expect(search).toContainText("Búsqueda activa");
    const next = search.locator('time[data-observation="next"]');
    await expect(next).toHaveAttribute(
      "datetime",
      new Date(now + 15_000).toISOString(),
    );
    await expect(
      search.locator('time[data-observation="last"]'),
    ).toHaveAttribute("datetime", new Date(now).toISOString());
    s.observationFails(true);
    now += 1000;
    polling.wake();
    await polling.pending;
    await expect(search).toContainText("Búsqueda con error");
    await expect(search).toContainText("Reintento automático programado");
    await expect(next).toHaveAttribute(
      "datetime",
      new Date(now + 15_000).toISOString(),
    );
    s.observationFails(false);
    polling.wake();
    await polling.pending;
    await expect(search).toContainText("Búsqueda activa");
    s.facts.preview = { ...ready!, state: "failure" };
    polling.wake();
    await polling.pending;
    await expect(search).toContainText("Búsqueda con error");
    s.facts.preview = null;
    conversation.add("Reintentar");
    now += 1000;
    polling.wake();
    await polling.pending;
    await expect(search).toContainText("Búsqueda activa");
    expect(s.workflow.view(run.id)?.publication?.previewWait?.startedAt).toBe(
      startedAt,
    );
    expect(s.workflow.view(run.id)?.publication?.previewWait?.state).toBe(
      "waiting",
    );
    polling.halt();
    await expect(search).toContainText("Búsqueda pausada");
    await expect(next).toHaveCount(0);
    polling = makePolling();
    polling.wake();
    await polling.pending;
    await expect(search).toContainText("Búsqueda activa");
    const current = s.workflow.view(run.id)!;
    current.publication!.recoveryRequired = true;
    s.workflow.factory.persist(current);
    polling.wake();
    await polling.pending;
    await expect(search).toContainText("Búsqueda pausada");
    await expect(search).toContainText("Reintentar");
    await expect(next).toHaveCount(0);
    conversation.add("Reintentar");
    s.facts.preview = ready;
    now += 1000;
    polling.wake();
    await polling.pending;
    await expect(search).toContainText("Preview comprobada");
    await expect(next).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Contexto ↗" }).click();
    await expect(search).toContainText("Preview comprobada");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("preview-search-mobile.png"),
      fullPage: true,
    });
    await page.route("**/api/view*", (route) => route.abort());
    await expect(search).toContainText("Búsqueda sin confirmar");
  } finally {
    polling.halt();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    s.close();
  }
});
