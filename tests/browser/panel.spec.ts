import { test, expect } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { verificationFixture } from "../support/verification.ts";
import { createFactory } from "../../src/composition/factory.ts";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import type { Fact, AgentPort } from "../../src/application/agent.ts";

test("el dashboard observa el estado persistido de la API, el trabajo pendiente, las salidas de texto y el historial tras reiniciar", async ({
  page,
}) => {
  const root = mkdtempSync(join(tmpdir(), "foundry-browser-"));
  let emit: (fact: Fact) => void = () => {};
  const agent: AgentPort = {
    async start(sink) {
      emit = sink;
      return {
        pid: 123,
        version: "1.19.3",
        configuration: { model: "google/gemini-2.5-flash" },
      };
    },
    async resume() {},
    async create() {
      return "s1";
    },
    async send() {},
    async stop() {
      return {
        exited: true,
        detail: "Fake owned process absent; remote work unknown",
      };
    },
  };
  const config = {
    dataDir: root,
    projectDir: root + "/project",
    provider: "google",
    model: "gemini-2.5-flash",
    auth: "opencode" as const,
  };
  let factory = createFactory(config, agent, {
    secrets: ["fictional-secret-123"],
  });
  const run = await factory.run("Inspeccionar el paquete del Managed project");
  emit({ type: "status", status: "busy" });
  emit({
    type: "part",
    id: "p1",
    messageId: "m1",
    kind: "text",
    text: "Primer fragmento",
  });
  emit({ type: "status", status: "idle" });
  let server = panelServer(factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await expect(
      page.getByRole("heading", {
        name: "Inspeccionar el paquete del Managed project",
      }),
    ).toBeVisible();
    await expect(page.locator(".dashboard-status")).toHaveText("En curso");
    await page.getByRole("button", { name: /Registro técnico/ }).click();
    await expect(page.locator(".dashboard-entries")).toContainText("busy");
    await expect(page.locator(".dashboard-entries")).toContainText("idle");
    emit({
      type: "part",
      id: "p1",
      messageId: "m1",
      kind: "text",
      text: "Resultado fictional-secret-123 <img src=x onerror=alert(1)>",
    });
    emit({
      type: "pending",
      pending: [
        { id: "q1", kind: "question", text: "¿Qué archivo debo modificar?" },
      ],
    });
    await expect(
      page.getByRole("heading", { name: "El agente tiene una pregunta" }),
    ).toBeVisible();
    await expect(page.locator(".dashboard-message pre")).toContainText(
      "Resultado [REDACTED] <img src=x onerror=alert(1)>",
    );
    await expect(page.locator(".dashboard-message img")).toHaveCount(0);
    await expect(page.locator(".dashboard-message pre")).not.toContainText(
      "fictional-secret-123",
    );
    await page
      .getByRole("button", { name: "Configuración, procesos y evidencia" })
      .click();
    const output = page.getByRole("button", { name: /\+ text/ });
    await output.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".output pre")).toContainText(
      "Resultado [REDACTED] <img src=x onerror=alert(1)>",
    );
    await expect(page.locator(".output img")).toHaveCount(0);
    await page.getByRole("button", { name: "Cerrar detalle" }).click();
    expect(
      (await page.request.post(`http://127.0.0.1:${port}/api/view`)).status(),
    ).toBe(405);
    expect(
      (
        await page.request.get(`http://127.0.0.1:${port}/api/view`, {
          headers: { Origin: "https://external.example" },
        })
      ).status(),
    ).toBe(403);
    emit({ type: "error", text: "Provider unavailable" });
    await expect(page.locator(".dashboard-global-alert").first()).toContainText(
      "Provider unavailable",
    );
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    factory.close();
    factory = createFactory(config, agent);
    server = panelServer(factory);
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    await page.reload();
    await expect(page.locator(".dashboard-global-alert").first()).toContainText(
      "no se reenvió la tarea",
    );
    await page.getByRole("button", { name: /Registro técnico/ }).click();
    await expect(page.locator(".dashboard-entries")).toContainText("busy");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(factory.view(run.id)!.status).toBe("intervention");
  } finally {
    server.closeAllConnections();
    server.close();
    factory.close();
  }
});

test("la conexión local y los avisos automáticos de actividad usan relojes distintos y nunca vuelven a enviar trabajo", async ({
  page,
}) => {
  const root = mkdtempSync(join(tmpdir(), "foundry-clock-"));
  let sends = 0;
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
        return { pid: 123, version: "1.19.3", configuration: {} };
      },
      async resume() {},
      async create() {
        return "s1";
      },
      async send() {
        sends++;
      },
      async stop() {
        return { exited: true, detail: "test" };
      },
    },
  );
  await factory.run("Observar sin reintentar");
  const server = panelServer(factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await page.clock.install({ time: new Date() });
    await page.goto(origin);
    await expect(page.locator(".dashboard-system-footer")).toContainText(
      "Factory conectada",
    );
    await page.clock.fastForward(121_000);
    await expect(
      page.getByText(/Sin actividad del agente durante 2 minutos/),
    ).toBeVisible();
    await expect(
      page.getByText(/Sin observación correcta de OpenCode/),
    ).toBeVisible();
    emit({
      type: "pending",
      pending: [{ id: "p1", kind: "permission", text: "edit" }],
    });
    await page.clock.fastForward(2000);
    await expect(
      page.getByText(/Sin actividad del agente durante 2 minutos/),
    ).toHaveCount(0);
    await page.route("**/api/view*", (route) => route.abort());
    await page.clock.fastForward(31_000);
    await expect(
      page.getByText(/Sin respuesta local durante 30 segundos/),
    ).toBeVisible();
    await page.unroute("**/api/view*");
    await page.clock.fastForward(2000);
    await expect(page.locator(".dashboard-system-footer")).toContainText(
      "Factory conectada",
    );
    expect(sends).toBe(1);
  } finally {
    server.closeAllConnections();
    server.close();
    factory.close();
  }
});

test("el dashboard conserva la lectura al recibir actividad y permite volver al final", async ({
  page,
}) => {
  const s = verificationFixture();
  const server = panelServer(s.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await page.goto(origin);
    await expect(
      page.getByRole("heading", { name: "Todo empieza con una petición" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Revisar autorización en GitHub" }),
    ).toHaveAttribute(
      "href",
      `https://github.com/${s.project.repository}/issues`,
    );
    await s.start();
    for (let index = 0; index < 50; index++) {
      s.emit({
        type: "part",
        id: `tool-${index}`,
        messageId: `message-${index}`,
        kind: "tool",
        label: `Consultar archivo ${index}`,
        text: `Contenido del archivo ${index}`,
      });
    }
    await expect(
      page
        .locator(".dashboard-output-toggle")
        .filter({ hasText: "Consultar archivo" }),
    ).toHaveCount(50);
    const stream = page.getByLabel("Cronología, desplazamiento independiente");
    await stream.focus();
    await page.keyboard.press("Home");
    await expect(
      page.getByRole("button", { name: /Volver al final/ }),
    ).toBeVisible();
    const firstRow = page.locator('[data-entry-id="part-tool-0"]');
    await expect
      .poll(() => stream.evaluate((element) => element.scrollTop))
      .toBe(0);
    await expect(firstRow).toBeInViewport();
    const before = (await firstRow.boundingBox())!.y;
    s.emit({
      type: "part",
      id: "new-tool",
      messageId: "new-message",
      kind: "tool",
      label: "Nueva herramienta",
      text: "Salida nueva",
    });
    await expect(
      page.getByRole("button", { name: /novedad.*Volver al final/ }),
    ).toBeVisible();
    expect(Math.abs((await firstRow.boundingBox())!.y - before)).toBeLessThan(
      2,
    );
    await page.getByRole("button", { name: /Volver al final/ }).click();
    await expect(
      page.getByRole("button", { name: /Nueva herramienta/ }),
    ).toBeInViewport();
    await expect(page.getByText("Estás al día", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Nueva herramienta/ }).click();
    await expect(page.getByText("Salida nueva", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: /Ejecuciones.*1/ }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "Accessible catalogue",
    );
    await page.getByRole("button", { name: /Accessible catalogue/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    s.close();
  }
});
