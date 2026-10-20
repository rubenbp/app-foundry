import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { createFactory } from "../../src/composition/factory.ts";
import { Store } from "../../src/infrastructure/persistence/store.ts";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import type { Fact } from "../../src/application/agent.ts";

async function timelineFixture(page: Page) {
  const root = mkdtempSync(join(tmpdir(), "foundry-timeline-"));
  let emit: (fact: Fact) => void = () => {};
  let now = Date.now();
  const factory = createFactory(
    {
      dataDir: root,
      projectDir: join(root, "project"),
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
        return { exited: true, detail: "Owned process stopped" };
      },
    },
    { now: () => now, secrets: ["fictional-secret-123"] },
  );
  const run = await factory.run("Relacionar actividad y evidencia");
  const part = (id: string, text: string, kind = "text", label = id) => {
    now += 1000;
    emit({ type: "part", id, messageId: "message", kind, label, text });
  };
  let persistenceClosed = false;
  const server = panelServer(factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  return {
    factory,
    run,
    part,
    emit,
    origin,
    async open() {
      await page.goto(origin);
    },
    closePersistence() {
      if (!persistenceClosed) {
        factory.close();
      }
      persistenceClosed = true;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (!persistenceClosed) {
        factory.close();
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("una cronología relaciona mensajes, herramientas y fallos; el registro original conserva todos los hechos sin duplicar salidas", async ({
  page,
}) => {
  const fixture = await timelineFixture(page);
  try {
    fixture.part("message", "Mensaje retenido");
    fixture.part(
      "tool",
      JSON.stringify({
        tool: "read",
        status: "error",
        input: { path: "README.md" },
        output: "<img src=x onerror=alert(1)> fictional-secret-123",
        error: "No se pudo leer",
      }),
      "tool",
      "read · error",
    );
    fixture.emit({ type: "status", status: "session.tool.failed" });
    const reads: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/outputs/")) {
        reads.push(request.url());
      }
    });
    await fixture.open();
    const timeline = page.getByRole("list", { name: "Cronología" });
    await expect(timeline).toContainText("message");
    await expect(timeline).toContainText("Herramienta · Fallo");
    await expect(timeline).toContainText("session.tool.failed");
    expect(reads).toHaveLength(0);
    const tool = timeline.getByRole("button", { name: /read · error/ });
    await tool.focus();
    await page.keyboard.press("Enter");
    await expect(tool).toHaveAttribute("aria-expanded", "true");
    const output = timeline.locator("#output-tool");
    await expect(output).toContainText('"input"');
    await expect(output).toContainText('"error"');
    await expect(output).toContainText("[REDACTED]");
    await expect(output).toContainText("<img src=x onerror=alert(1)>");
    await expect(output.locator("img")).toHaveCount(0);
    await expect(output).not.toContainText("fictional-secret-123");
    await expect(timeline).not.toContainText("Create OpenCode session");
    await page.getByRole("checkbox", { name: "Registro técnico" }).check();
    await expect(timeline).toContainText("Create OpenCode session");
    await expect(timeline.locator("#part-tool")).toHaveCount(1);
    await page.getByText("Ver registro original", { exact: true }).click();
    const original = page.getByRole("region", { name: "Registro original" });
    await expect(original).toContainText("part: tool: read · error");
    await expect(
      original.getByRole("link", { name: "read · error" }),
    ).toBeVisible();
  } finally {
    await fixture.close();
  }
});

test("la salida abierta renueva su última observación sin copias y conserva esa observación ante error y ausencia del artefacto", async ({
  page,
}) => {
  const fixture = await timelineFixture(page);
  try {
    fixture.part("live", "Primera observación");
    fixture.part("later", "Otra entrada");
    await fixture.open();
    const timeline = page.getByRole("list", { name: "Cronología" });
    const button = timeline.getByRole("button", { name: /live/ });
    let release: () => void = () => {};
    await page.route("**/outputs/live", async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.continue();
    });
    await button.click();
    await expect(timeline.getByText("Cargando salida…")).toBeVisible();
    release();
    await expect(timeline.locator("#output-live")).toHaveText(
      "Primera observación",
    );
    await page.unroute("**/outputs/live");
    fixture.part("live", "Segunda observación");
    await expect(timeline.locator("#output-live")).toHaveText(
      "Segunda observación",
    );
    await expect(timeline.locator("#part-live")).toHaveCount(1);
    await expect(
      timeline.locator("li[data-entry-id^='part-']").last(),
    ).toHaveAttribute("data-entry-id", "part-live");
    await page.route("**/outputs/live", (route) => route.abort());
    fixture.part("live", "Tercera observación inaccesible");
    await expect(timeline.getByRole("alert")).toContainText(
      "Error al leer la salida",
    );
    await expect(timeline.locator("#output-live")).toHaveText(
      "Segunda observación",
    );
    await expect(
      timeline.getByText(/Última observación disponible · Sin actualizar/),
    ).toBeVisible();
    await page.unroute("**/outputs/live");
    fixture.part("live", "Cuarta observación ausente");
    // Keep the persisted reference but remove the retained artifact.
    if (!(fixture.factory.store instanceof Store)) {
      throw new Error("Expected the real artifact store");
    }
    rmSync(fixture.factory.store.artifact(fixture.run.id, "live"));
    await expect(timeline.getByText(/Artefacto ausente/)).toBeVisible();
    await expect(timeline.locator("#output-live")).toHaveText(
      "Segunda observación",
    );
    fixture.part("live", "Observación recuperada");
    await expect(timeline.locator("#output-live")).toHaveText(
      "Observación recuperada",
    );
    await expect(timeline.getByRole("alert")).toHaveCount(0);
    await expect(timeline.getByText(/Artefacto ausente/)).toHaveCount(0);
  } finally {
    await fixture.close();
  }
});

test("el registro original localiza y abre con teclado una salida truncada sin mover la página exterior", async ({
  page,
}) => {
  const fixture = await timelineFixture(page);
  try {
    fixture.part("large", "Fragmento retenido\n" + "x".repeat(70_000));
    for (let index = 0; index < 14; index++) {
      fixture.part(`message-${index}`, `Mensaje ${index}`);
    }
    await fixture.open();
    await page.getByText("Ver registro original", { exact: true }).click();
    const link = page
      .getByRole("region", { name: "Registro original" })
      .getByRole("link", { name: "large" });
    await link.focus();
    const before = await page.evaluate(() => ({
      body: document.scrollingElement!.scrollTop,
      top: document.querySelector(".activity-scroll")!.scrollTop,
    }));
    await page.keyboard.press("Enter");
    const button = page.locator("#output-toggle-large");
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#output-large")).toContainText(
      "Fragmento retenido",
    );
    await expect(
      page.getByText(
        "Salida truncada. Solo se conserva el fragmento disponible.",
      ),
    ).toBeVisible();
    const after = await page.evaluate(() => ({
      body: document.scrollingElement!.scrollTop,
      top: document.querySelector(".activity-scroll")!.scrollTop,
    }));
    expect(after.body).toBe(before.body);
    expect(after.top).toBeLessThan(before.top);
  } finally {
    await fixture.close();
  }
});

test("un fallo HTTP local real no sustituye la última salida por un éxito vacío", async ({
  page,
}) => {
  const fixture = await timelineFixture(page);
  try {
    fixture.part("retained", "Observación conservada antes del fallo");
    await fixture.open();
    const button = page.getByRole("button", { name: /retained/ });
    await button.click();
    await expect(page.locator("#output-retained")).toHaveText(
      "Observación conservada antes del fallo",
    );
    await button.click();
    fixture.closePersistence();
    const failedRead = page.waitForResponse(
      (response) =>
        response.url().endsWith("/outputs/retained") &&
        response.status() === 500,
    );
    await button.click();
    await failedRead;
    await expect(
      page.locator("#part-retained").getByRole("alert"),
    ).toContainText("Error al leer la salida");
    await expect(page.locator("#output-retained")).toHaveText(
      "Observación conservada antes del fallo",
    );
    await expect(
      page.getByText(/Última observación disponible · Sin actualizar/),
    ).toBeVisible();
  } finally {
    await fixture.close();
  }
});
