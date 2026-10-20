import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import { verificationFixture } from "../support/verification.ts";
import { execute } from "../../src/infrastructure/process.ts";

test("la comprobación conserva estado y advertencia de cierre con diagnóstico plegado", async ({
  page,
}) => {
  let entered!: () => void;
  const checking = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const fixture = verificationFixture({
    process: async (command, args, options) => {
      if (
        command === "/bin/sh" &&
        args[1] === "node check.mjs" &&
        ++calls === 2
      ) {
        options.onStart?.(123456);
        entered();
        await blocked;
        return { code: 0, output: "catalogue checked" };
      }
      return execute(command, args, options);
    },
  });
  await fixture.start();
  fixture.commit("catalogue.txt", "New catalogue", "Improve catalogue");
  const server = panelServer(fixture.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let verifying:
    ReturnType<typeof fixture.workflow.verifyCandidate> | undefined;
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    fixture.finish();
    verifying = fixture.workflow.verifyCandidate();
    await checking;
    const section = page.getByRole("region", {
      name: "Verificación independiente",
    });
    const check = section
      .getByRole("listitem")
      .filter({ has: page.getByText("node check.mjs", { exact: true }) });
    await expect(
      check.getByText("En ejecución", { exact: true }),
    ).toBeVisible();
    await expect(
      check.getByText("Finalización del proceso pendiente de confirmar.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      check.getByText("Grupo del comando: 123456", { exact: true }),
    ).not.toBeVisible();
    await check
      .getByText("Diagnóstico del comando y cierre", { exact: true })
      .click();
    await expect(
      check.getByText("Grupo del comando: 123456", { exact: true }),
    ).toBeVisible();
    release();
    await verifying;
    await expect(check.getByText("Aprobada", { exact: true })).toBeVisible();
    await expect(
      check.getByText(/Comando finalizado; sus comprobaciones de cierre/),
    ).toBeVisible();
    await expect(
      check.getByText("Limpieza confirmada", { exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
    await verifying;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fixture.close();
  }
});

test("el alcance E2E mantiene offline y omisiones visibles con el entorno plegado", async ({
  page,
}) => {
  const fixture = verificationFixture({
    commands: ["node e2e.mjs"],
    files: { "e2e.mjs": "console.log('base checked')" },
    e2e: {
      command: "node e2e.mjs",
      configFile: "playwright.config.mjs",
      serverCommand: "static-server",
      origin: "http://127.0.0.1:4173",
      serves: "dist",
      reuseExistingServer: false,
      offline: true,
    },
    process: async (command, args, options) => {
      if (command === "/bin/sh" && args[1]?.includes("--config")) {
        return {
          code: 0,
          output:
            'FACTORY_E2E_METADATA=[{"name":"chromium","channel":"chrome","executablePath":null}]\n' +
            JSON.stringify(
              {
                config: {},
                stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 0 },
                errors: [],
              },
              null,
              2,
            ),
        };
      }
      return execute(command, args, options);
    },
  });
  await fixture.start();
  fixture.finish();
  const verified = (await fixture.workflow.verifyCandidate())!;
  // A retained report may contain omitted tests; current workflows reject that evidence.
  // Persist that historical state through the same repository used by the local HTTP projection.
  verified.verification!.e2e!.skippedTests = 1;
  verified.verification!.checks[0].status = "failed";
  verified.verification!.status = "failed";
  verified.verification!.error = "Retained E2E report includes omitted tests";
  verified.status = "intervention";
  fixture.workflow.factory.store.save(verified);
  const server = panelServer(fixture.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    const section = page.getByRole("region", {
      name: "Verificación independiente",
    });
    await expect(
      section.getByText("2 pruebas ejecutadas · 1 omitidas.", { exact: true }),
    ).toBeVisible();
    await expect(
      section.getByText("Navegador observado: chromium", { exact: true }),
    ).toBeVisible();
    await expect(
      section.getByText(/Modo offline: alcance local/),
    ).toBeVisible();
    await expect(section.getByText(/Hay pruebas omitidas/)).toBeVisible();
    await expect(section.getByText(/Servidor propio:/)).not.toBeVisible();
    await section.getByText("Entorno E2E observado", { exact: true }).click();
    await expect(
      section.getByText(/Servidor propio: http:\/\/127.0.0.1:4173/),
    ).toBeVisible();
    await expect(section.getByText(/Canal: chrome/)).toBeVisible();
    await expect(section.getByText(/Ejecutable: No observado/)).toBeVisible();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fixture.close();
  }
});

test("los criterios numerados separan evidencia común y específica y el informe extenso se consulta sin mover la página", async ({
  page,
}) => {
  const fixture = verificationFixture({
    body:
      "## Acceptance criteria\n" +
      Array.from(
        { length: 32 },
        (_, index) =>
          `- [ ] Criterio ${index + 1}: conservar la navegación y la evidencia observada.`,
      ).join("\n"),
  });
  await fixture.start();
  fixture.finish();
  const retained = (await fixture.workflow.verifyCandidate())!;
  retained.verification!.criteria[0].evidence.push("verification-diff");
  fixture.workflow.factory.store.save(retained);
  const server = panelServer(fixture.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    const section = page.getByRole("region", {
      name: "Verificación independiente",
    });
    await expect(
      section.getByRole("heading", {
        name: "Evidencia común a todos los criterios",
      }),
    ).toBeVisible();
    await expect(
      section.getByRole("link", {
        name: "Contrato técnico: node check.mjs",
        exact: true,
      }),
    ).toHaveCount(1);
    const criteria = section.getByRole("list", {
      name: "Criterios de aceptación",
    });
    await expect(
      criteria
        .getByRole("listitem")
        .filter({ has: page.getByRole("heading", { name: /^Criterio \d+:/ }) }),
    ).toHaveCount(32);
    await expect(
      criteria.getByRole("heading", {
        name: "Criterio 1: conservar la navegación y la evidencia observada.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      criteria.getByRole("link", {
        name: "Evidencia específica: verification-diff",
      }),
    ).toHaveAttribute("href", "#part-verification-diff");
    await expect(
      criteria.getByText("Juicio humano pendiente", { exact: true }),
    ).toHaveCount(32);
    await page.screenshot({
      path: test.info().outputPath("verification-desktop.png"),
    });
    const aside = page.getByRole("complementary", {
      name: "Contexto de la fase consultada",
    });
    expect(
      await aside.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    await aside.focus();
    await page.keyboard.press("End");
    await expect
      .poll(() => aside.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(100);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // The real retained report occupies the aside; focus navigation also reaches its last disclosure.
    await section
      .getByText("Registro original de criterios y controles", { exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(section.locator("pre").last()).toContainText(
      "- [ ] Criterio 32:",
    );
    await page
      .getByRole("link", { name: "Verificación y evidencias", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Verificación y evidencias",
      exact: true,
    });
    await expect(
      dialog.getByRole("heading", {
        name: "Evidencia común a todos los criterios",
      }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Juicio humano pendiente", { exact: true }),
    ).toHaveCount(32);
    await dialog
      .getByRole("link", { name: "Evidencia específica: verification-diff" })
      .focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#output-verification-diff")).toContainText(
      "Base",
    );
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Consultar contexto" }).click();
    const mobile = page.getByRole("dialog", {
      name: "Contexto · Verificación",
    });
    await expect(
      mobile.getByRole("heading", {
        name: "Criterio 1: conservar la navegación y la evidencia observada.",
        exact: true,
      }),
    ).toBeVisible();
    for (let index = 0; index < 14; index++) {
      await page.keyboard.press("Tab");
      expect(
        await mobile.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({
      path: test.info().outputPath("verification-mobile.png"),
    });
    await page.keyboard.press("Escape");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fixture.close();
  }
});

test("el reinicio conserva comprobaciones inciertas y no ejecutadas, ausencia E2E y criterios sin evidencia", async ({
  page,
}) => {
  let entered!: () => void;
  const checking = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const fixture = verificationFixture({
    commands: ["node check.mjs", "node check.mjs --later"],
    process: async (command, args, options) => {
      if (
        command === "/bin/sh" &&
        args[1] === "node check.mjs" &&
        ++calls === 2
      ) {
        options.onStart?.(123456);
        entered();
        await blocked;
        return { code: 0, output: "catalogue checked" };
      }
      return execute(command, args, options);
    },
  });
  await fixture.start();
  fixture.finish();
  const verifying = fixture.workflow.verifyCandidate();
  void verifying.catch(() => {});
  await checking;
  fixture.reopen();
  const server = panelServer(fixture.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    const section = page.getByRole("region", {
      name: "Verificación independiente",
    });
    await expect(
      section.getByText("Ejecución sin confirmar", { exact: true }),
    ).toBeVisible();
    await expect(
      section.getByText("No ejecutada", { exact: true }),
    ).toBeVisible();
    await expect(
      section.getByText(
        "Finalización del proceso incierta; requiere inspección manual.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      section.getByText("Grupo del comando: 123456", { exact: true }),
    ).not.toBeVisible();
    await expect(
      section.getByText(
        "E2E: sin informe observado; pruebas ejecutadas, omitidas y navegador no disponibles.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      section.getByText("0 pruebas ejecutadas", { exact: false }),
    ).toHaveCount(0);
    await expect(
      section.getByText("Falta evidencia", { exact: true }),
    ).toHaveCount(2);
    await expect(
      section.getByText("Sin evidencia asociada a este criterio.", {
        exact: true,
      }),
    ).toHaveCount(2);
    await expect(
      section
        .getByRole("listitem")
        .filter({ hasText: /^No criterion-specific automated evidence/ }),
    ).toHaveCount(2);
    await expect(
      section.getByRole("heading", {
        name: "Evidencia común a todos los criterios",
      }),
    ).toHaveCount(0);
    const activator = page.getByRole("link", {
      name: "Verificación y evidencias",
      exact: true,
    });
    await activator.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Verificación y evidencias",
      exact: true,
    });
    await expect(
      dialog.getByText("Ejecución sin confirmar", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        "Finalización del proceso incierta; requiere inspección manual.",
        { exact: true },
      ),
    ).toBeVisible();
    const labels = await page
      .getByRole("region", {
        name: "Verificación independiente",
        includeHidden: true,
      })
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("aria-labelledby")),
      );
    expect(new Set(labels).size).toBe(labels.length);
    await page.keyboard.press("Escape");
    await expect(activator).toBeFocused();
  } finally {
    release();
    await verifying.catch(() => {});
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fixture.close();
  }
});
