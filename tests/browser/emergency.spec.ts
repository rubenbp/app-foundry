import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { createFactory } from "../../src/composition/factory.ts";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import type { FactoryView } from "../../src/application/factoryView.ts";
import { setup } from "../support/admission.ts";

for (const clipboardAvailable of [true, false]) {
  test(`la modal muestra los comandos de la ejecución y ${clipboardAvailable ? "los copia al portapapeles" : "permite copiarlos manualmente si el portapapeles falla"}`, async ({
    page,
    context,
  }) => {
    const s = setup();
    const factory = createFactory(s.config, s.agent);
    const first = factory.enqueue("Primera prueba de emergencia");
    first.status = "intervention";
    factory.persist(first);
    const second = factory.enqueue("Segunda prueba de emergencia");
    second.status = "intervention";
    factory.persist(second);
    factory.active = first.id;
    const server = panelServer(factory);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      if (clipboardAvailable) {
        await context.grantPermissions(["clipboard-read", "clipboard-write"], {
          origin,
        });
      } else {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: () => Promise.reject(new Error("Clipboard denied")),
            },
          });
        });
      }
      await page.goto(origin);
      await page
        .getByRole("button", { name: "Configuración, procesos y evidencia" })
        .click();
      const emergencies = page.getByRole("region", {
        name: "Para emergencias",
      });
      await expect(emergencies).toContainText("factory.local.json");
      await expect(emergencies).toContainText("Con la Factory funcionando");
      await expect(emergencies).toContainText(
        "Cierra primero la Factory con Ctrl-C",
      );
      await expect(emergencies).toContainText("Ejemplo:");
      const snapshot: FactoryView = await page.request
        .get(`${origin}/api/view?run=${first.id}`)
        .then((response) => response.json());
      const expected = snapshot.emergencyCommands!;
      const actions = [
        { name: "parar", command: expected.stop },
        { name: "descartar", command: expected.discard! },
      ];
      for (const { name, command } of actions) {
        const button = emergencies.getByRole("button", {
          name: `Copiar comando para ${name}`,
          exact: true,
        });
        await button.focus();
        await page.keyboard.press("Enter");
        if (clipboardAvailable) {
          await expect(
            emergencies.getByText(`Comando para ${name} copiado.`, {
              exact: true,
            }),
          ).toBeVisible();
          expect(
            await page.evaluate(() => navigator.clipboard.readText()),
          ).toBe(command);
        } else {
          const article = button.locator("..").locator("..");
          await expect(article.getByRole("status")).toHaveText(
            "No se pudo copiar. Selecciona el comando y cópialo manualmente.",
          );
          await article.locator("code").selectText();
          expect(
            await page.evaluate(() => window.getSelection()?.toString()),
          ).toBe(command);
        }
      }
      await emergencies.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: test.info().outputPath("emergency-desktop.png"),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await emergencies
        .getByRole("button", {
          name: "Copiar comando para descartar",
          exact: true,
        })
        .scrollIntoViewIfNeeded();
      expect(
        await emergencies.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .getByRole("dialog")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: test.info().outputPath("emergency-mobile.png"),
      });
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.getByRole("button", { name: new RegExp(second.task) }).click();
      await page
        .getByRole("button", { name: "Configuración, procesos y evidencia" })
        .click();
      await expect(emergencies.locator("pre").first()).toContainText(second.id);
      await expect(emergencies).not.toContainText(first.id);
      await expect(emergencies).not.toContainText(
        "Comando para parar copiado.",
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      factory.close();
      rmSync(s.root, { recursive: true, force: true });
    }
  });
}
