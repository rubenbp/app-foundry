import { test as base, expect } from "@playwright/test";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { createFactory } from "../../src/composition/factory.ts";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import { setup } from "../support/admission.ts";

const test = base.extend<{ origin: string }>({
  // Playwright inspects this pattern to discover fixture dependencies.
  // eslint-disable-next-line no-empty-pattern
  origin: async ({}, use) => {
    const s = setup();
    const factory = createFactory(s.config, s.agent);
    factory.enqueue("Primera ejecución");
    factory.enqueue("Segunda ejecución");
    const server = panelServer(factory);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    try {
      await use(`http://127.0.0.1:${port}`);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      factory.close();
      rmSync(s.root, { recursive: true, force: true });
    }
  },
});

test("una preferencia inválida muestra los registros técnicos por defecto", async ({
  page,
  origin,
}) => {
  await page.goto(origin);
  await page.evaluate(() => {
    localStorage.setItem("app-foundry:show-technical-records:v1", "invalid");
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Registro técnico/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: /Ver registro original/ }),
  ).toBeVisible();
});

test("la preferencia se comparte entre ejecuciones y se recupera al abrir otra pestaña", async ({
  page,
  context,
  origin,
}) => {
  await page.goto(origin);
  const toggle = page.getByRole("button", { name: /Registro técnico/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await page.getByRole("button", { name: /Segunda ejecución/ }).click();
  await expect(
    page.getByRole("heading", { name: "Segunda ejecución" }),
  ).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  const otherPage = await context.newPage();
  await otherPage.goto(origin);
  const otherToggle = otherPage.getByRole("button", {
    name: /Registro técnico/,
  });
  await expect(otherToggle).toHaveAttribute("aria-pressed", "false");
  await otherToggle.click();
  await expect(otherToggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});

for (const failure of ["read", "write", "access"] as const) {
  test(`el selector sigue operativo si falla localStorage: ${failure}`, async ({
    page,
    origin,
  }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") {
        warnings.push(message.text());
      }
    });
    await page.addInitScript((failure) => {
      if (failure === "access") {
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new DOMException("Storage blocked", "SecurityError");
          },
        });

        return;
      }
      Object.defineProperty(
        Storage.prototype,
        failure === "read" ? "getItem" : "setItem",
        {
          value() {
            throw new DOMException("Storage unavailable", "QuotaExceededError");
          },
        },
      );
    }, failure);
    await page.goto(origin);
    const toggle = page.getByRole("button", { name: /Registro técnico/ });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: /Segunda ejecución/ }).click();
    await expect(
      page.getByRole("heading", { name: "Segunda ejecución" }),
    ).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("button", { name: /Ver registro original/ }),
    ).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: /Ver registro original/ }),
    ).toBeVisible();
    expect(
      warnings.some((message) =>
        message.includes(
          failure === "read" ? "No se pudo leer" : "No se pudo guardar",
        ),
      ),
    ).toBe(true);
  });
}
