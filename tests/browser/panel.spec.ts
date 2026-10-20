import { test, expect } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
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
      page.getByRole("heading", { name: "Centro de ejecuciones" }),
    ).toBeVisible();
    await expect(page.locator(".badge.running")).toHaveText("En curso");
    await page.getByRole("checkbox", { name: "Registro técnico" }).check();
    await expect(page.getByRole("list", { name: "Cronología" })).toContainText(
      "busy",
    );
    await expect(page.locator(".timeline")).toContainText("idle");
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
      page.getByRole("heading", { name: "Solicitudes pendientes" }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Cronología" }).locator(".output"),
    ).toHaveCount(1);
    const output = page.getByRole("button", { name: /\+ text/ });
    await output.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".output pre")).toContainText(
      "Resultado [REDACTED] <img src=x onerror=alert(1)>",
    );
    await expect(page.locator(".output img")).toHaveCount(0);
    await expect(page.locator(".output pre")).not.toContainText(
      "fictional-secret-123",
    );
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
    await expect(page.locator(".notice.danger")).toContainText(
      "Provider unavailable",
    );
    await expect(
      page.getByText(
        "Ejecución manual sin issue de GitHub. Consulta el contexto local y la CLI para detener el trabajo.",
      ),
    ).toBeVisible();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    factory.close();
    factory = createFactory(config, agent);
    server = panelServer(factory);
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    await page.reload();
    await expect(page.locator(".notice.danger")).toContainText(
      "no se reenvió la tarea",
    );
    await page.getByRole("checkbox", { name: "Registro técnico" }).check();
    await expect(page.getByRole("list", { name: "Cronología" })).toContainText(
      "busy",
    );
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
    await expect(page.locator(".connection")).toHaveText("Dashboard conectado");
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
    await expect(page.locator(".connection")).toHaveText("Dashboard conectado");
    expect(sends).toBe(1);
  } finally {
    server.closeAllConnections();
    server.close();
    factory.close();
  }
});
