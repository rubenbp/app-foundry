import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import { verificationFixture } from "../support/verification.ts";

test("consultar una fase conserva la selección durante el avance y mantiene visibles las solicitudes actuales", async ({
  page,
}) => {
  const fixture = verificationFixture();
  await fixture.start();
  const server = panelServer(fixture.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    const navigation = page.getByRole("navigation", {
      name: "Fases de la Ejecución",
    });
    const context = page.getByRole("complementary", {
      name: "Contexto de la fase consultada",
    });
    await expect(
      page
        .getByRole("list", { name: "Cronología", exact: true })
        .getByText("Issue autorizado · En cola", { exact: true }),
    ).toBeVisible();
    await expect(
      context.getByText("Verificación independiente", { exact: true }),
    ).toHaveCount(0);
    await navigation.getByRole("button", { name: /Preparación/ }).click();
    await expect(
      navigation.getByRole("button", { name: /Preparación/ }),
    ).toHaveAttribute("aria-pressed", "true");
    fixture.emit({
      type: "pending",
      pending: [
        {
          id: "q1",
          kind: "question",
          text: "Confirma el alcance del catálogo",
        },
      ],
    });
    await expect(
      page.getByRole("heading", { name: "Solicitudes pendientes" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Solicitudes pendientes" })
        .getByText("Confirma el alcance del catálogo", { exact: false }),
    ).toBeVisible();
    fixture.emit({ type: "pending", pending: [] });
    fixture.commit("catalogue.txt", "Improved catalogue", "Improve catalogue");
    fixture.finish();
    await fixture.workflow.verifyCandidate();
    await expect(
      navigation.getByRole("listitem").filter({ hasText: "Verificación" }),
    ).toHaveAttribute("aria-current", "step");
    await expect(
      navigation.getByRole("button", { name: /Preparación/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      context.getByRole("heading", { name: "Preparación", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Volver a la fase actual" }).click();
    await expect(
      context.getByRole("heading", { name: "Verificación", exact: true }),
    ).toBeVisible();
    await navigation.getByRole("button", { name: /Verificación/ }).click();
    await expect(
      context.getByRole("region", { name: "Verificación independiente" }),
    ).toBeVisible();
    await expect(page.evaluate(() => window.scrollY)).resolves.toBe(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fixture.close();
  }
});

test("los detalles conservan el encargo autorizado, destinos de código y foco contenido con Escape en escritorio y móvil", async ({
  page,
}) => {
  const fixture = verificationFixture({
    body:
      "## Acceptance criteria\n- Encargo retenido " + "autorizado ".repeat(350),
  });
  const run = await fixture.start();
  const server = panelServer(fixture.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const activator = page.getByRole("link", {
        name: "Encargo y criterios",
        exact: true,
      });
      await activator.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", {
        name: "Encargo y criterios",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByText("Encargo retenido", { exact: false }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("link", { name: /Issue #1/ }),
      ).toHaveAttribute("href", run.request!.url);
      const box = (await dialog.boundingBox())!;
      expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
      expect(Math.abs(box.y + box.height / 2 - 422)).toBeLessThan(2);
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press("Tab");
        expect(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        ).toBe(true);
      }
      const retainedText = dialog.locator("pre");
      await retainedText.hover();
      await page.mouse.wheel(0, 600);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(activator).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      if (width < 900) {
        await page.getByRole("button", { name: "Consultar contexto" }).click();
      }
      await page
        .getByRole("button", { name: "Código de la Ejecución", exact: true })
        .click();
      const code = page.getByRole("dialog", {
        name: "Código de la Ejecución",
        exact: true,
      });
      await expect(
        code.getByRole("link", {
          name: fixture.project.repository + " ↗",
          exact: true,
        }),
      ).toHaveAttribute(
        "href",
        `https://github.com/${fixture.project.repository}`,
      );
      await expect(
        code.getByRole("link", { name: "main ↗", exact: true }),
      ).toHaveAttribute(
        "href",
        `https://github.com/${fixture.project.repository}/tree/main`,
      );
      await expect(
        code.getByRole("link", {
          name: fixture.baseSha.slice(0, 7) + " ↗",
          exact: true,
        }),
      ).toHaveAttribute(
        "href",
        `https://github.com/${fixture.project.repository}/tree/${fixture.baseSha}`,
      );
      await expect(code).toContainText(
        "Trabajo local en la Factory. Sin PR publicada todavía.",
      );
      await expect(code.getByRole("link", { name: /codex\// })).toHaveCount(0);
      await code
        .getByText(
          "Identificadores completos, configuración e instrucciones capturadas",
          { exact: true },
        )
        .click();
      await expect(code).toContainText(run.workspace!.branch);
      await expect(code).toContainText("Keep keyboard navigation.");
      for (let index = 0; index < 12; index++) {
        await page.keyboard.press("Tab");
        const focused = await page.evaluate(() => {
          const box = document.activeElement!.getBoundingClientRect();

          return { top: box.top, bottom: box.bottom };
        });
        const viewport = (await code.boundingBox())!;
        expect(focused.top).toBeLessThan(viewport.y + viewport.height);
        expect(focused.bottom).toBeGreaterThan(viewport.y);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.keyboard.press("Escape");
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fixture.close();
  }
});
