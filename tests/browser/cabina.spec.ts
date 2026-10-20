import { test, expect } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { createFactory } from "../../src/composition/factory.ts";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import type { Fact } from "../../src/application/agent.ts";

test("Cabina mantiene la Ejecución, fases y regiones de lectura dentro del viewport", async ({
  page,
}) => {
  const root = mkdtempSync(join(tmpdir(), "foundry-cabina-"));
  let emit: (fact: Fact) => void = () => {};
  const factory = createFactory(
    {
      dataDir: root,
      projectDir: root + "/project",
      provider: "google",
      model: "gemini-2.5-flash",
      auth: "opencode",
    },
    {
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
        return { exited: true, detail: "test" };
      },
    },
  );
  for (let index = 0; index < 18; index++) {
    const previous = await factory.run(
      `Histórica ${index}: contexto conservado`,
    );
    await factory.stop(previous.id);
  }
  await factory.run(
    "Revisar un título largo del Managed project sin perder el estado de la Ejecución " +
      "contenido ".repeat(30),
  );
  for (let i = 0; i < 65; i++) {
    emit({
      type: "part",
      id: `p${i}`,
      messageId: `m${i}`,
      kind: "text",
      text: `Mensaje ${i} ` + "salida extensa ".repeat(80),
    });
  }
  const server = panelServer(factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    for (const [width, height] of [
      [1440, 960],
      [993, 987],
      [793, 987],
      [390, 844],
      [900, 960],
      [899, 960],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await expect(
        page.getByRole("navigation", { name: "Fases de la Ejecución" }),
      ).toBeInViewport();
      await expect(
        page.getByRole("heading", { name: "Implementación", exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByText("Ejecución manual · Sin issue de GitHub", {
            exact: true,
          })
          .first(),
      ).toBeVisible();
      await expect(
        page.getByText("gemini-2.5-flash", { exact: true }),
      ).toBeVisible();
      if (width === 1440 || width === 390) {
        await page.screenshot({
          path: test.info().outputPath(`cabina-${width}.png`),
        });
      }
      const geometry = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }));
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.height).toBeLessThanOrEqual(geometry.viewportHeight);
      if (width! >= 900) {
        await expect(
          page.getByRole("complementary", {
            name: "Navegación de ejecuciones",
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Cola de peticiones" }),
        ).toBeInViewport();
      } else {
        await expect(
          page.getByRole("combobox", { name: "Seleccionar Ejecución" }),
        ).toBeVisible();
      }
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    const activity = page.getByRole("region", {
      name: "Entradas de la cronología",
    });
    await activity.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => activity.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(
      page.getByRole("navigation", { name: "Fases de la Ejecución" }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const history = page.getByLabel("Historial de Ejecuciones", {
      exact: true,
    });
    await history.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => history.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await page.getByText("Observación y procedencia", { exact: true }).click();
    await page
      .getByText("Configuración, procesos y lagunas", { exact: true })
      .click();
    const context = page.getByRole("complementary", {
      name: "Contexto de la Ejecución",
    });
    await context.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => context.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(
      page.getByRole("navigation", { name: "Fases de la Ejecución" }),
    ).toBeInViewport();
    await expect(
      page.getByRole("heading", { name: "Centro de ejecuciones" }),
    ).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.setViewportSize({ width: 793, height: 987 });
    await page.getByRole("button", { name: "Consultar contexto" }).click();
    await expect(context).toBeInViewport();
    await page.getByRole("button", { name: "Cerrar contexto" }).click();
    await expect(activity).toBeInViewport();
    await page.setViewportSize({ width: 1440, height: 960 });
    let release = () => {};
    const responseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/view?run=*", async (route) => {
      await responseGate;
      await route.continue();
    });
    await page
      .getByRole("button", { name: /Histórica 0: contexto conservado/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Cargando ejecución", exact: true }),
    ).toHaveCount(2);
    await expect(
      page.getByRole("heading", { name: "Mensajes y herramientas" }),
    ).toHaveCount(0);
    release();
    await expect(
      page.getByRole("heading", {
        name: "Histórica 0: contexto conservado",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("Mensaje 64", { exact: false })).toHaveCount(0);
  } finally {
    server.closeAllConnections();
    server.close();
    factory.close();
  }
});

test("Cabina distingue carga, fallo de consulta y ausencia de Ejecuciones sin inventar métricas", async ({
  page,
}) => {
  const root = mkdtempSync(join(tmpdir(), "foundry-cabina-empty-"));
  const factory = createFactory(
    {
      dataDir: root,
      projectDir: root + "/project",
      provider: "google",
      model: "gemini-2.5-flash",
      auth: "opencode",
    },
    {
      async start() {
        return { pid: 123, version: "test", configuration: {} };
      },
      async resume() {},
      async create() {
        return "s1";
      },
      async send() {},
      async stop() {
        return { exited: true, detail: "test" };
      },
    },
  );
  const server = panelServer(factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await page.route("**/api/view*", (route) => route.abort());
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    await expect(
      page.getByRole("heading", { name: "Error de consulta", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No hay una vista disponible todavía.", { exact: false }),
    ).toBeVisible();
    await page.unroute("**/api/view*");
    await expect(
      page.getByRole("heading", { name: "Sin Ejecuciones", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No disponible", { exact: true })).toHaveCount(
      4,
    );
    await expect(page.getByText("No observado", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Cargando ejecución", { exact: true }),
    ).toHaveCount(0);
  } finally {
    server.closeAllConnections();
    server.close();
    factory.close();
  }
});
