import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFactory } from "../../src/composition/factory.ts";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import { artifactPath } from "../../src/infrastructure/persistence/artifactPath.ts";
import { setup } from "../support/admission.ts";

for (const status of ["completed", "stopped"] as const) {
  test(`el Dashboard confirma el borrado de una ejecución ${status}, permite cancelar y reintentar y vuelve al listado`, async ({
    page,
  }) => {
    const s = setup();
    const factory = createFactory(s.config, s.agent);
    const run = await factory.run("Eliminar esta ejecución");
    factory.ingest(run.id, {
      type: "part",
      id: "evidence",
      messageId: "m",
      kind: "text",
      text: "Local evidence",
    });
    await factory.stop(run.id);
    const finished = factory.view(run.id)!;
    finished.status = status;
    factory.persist(finished);
    const other = factory.enqueue("Conservar esta ejecución");
    for (const name of ["workspaces", "conversations"]) {
      mkdirSync(join(s.config.dataDir, name, run.id), { recursive: true });
      writeFileSync(
        join(s.config.dataDir, name, run.id, "owned.txt"),
        "Owned data",
      );
    }
    // A real filesystem error after partial cleanup exercises the retry through HTTP and SQLite.
    const blocked = artifactPath(s.config.dataDir, run.id, "evidence") + ".tmp";
    mkdirSync(blocked);
    const server = panelServer(factory);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      await page.goto(origin);
      await expect(
        page.getByRole("heading", { name: other.task }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Eliminar ejecución", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: /Eliminar esta ejecución/ })
        .click();
      const trigger = page.getByRole("button", {
        name: "Eliminar ejecución",
        exact: true,
      });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Eliminar ejecución" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Cancelar" }),
      ).toBeFocused();
      await expect(dialog).toContainText(
        "clon completo con sus cambios locales",
      );
      await expect(dialog).toContainText(
        "El issue, el código integrado y los recursos remotos se conservan",
      );
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      expect(factory.view(run.id)).not.toBeNull();
      await page.screenshot({
        path: test.info().outputPath("delete-detail-desktop.png"),
      });
      await trigger.click();
      await dialog.getByRole("button", { name: "Cancelar" }).click();
      await expect(dialog).not.toBeVisible();
      await trigger.click();
      await page.screenshot({
        path: test.info().outputPath("delete-confirm-desktop.png"),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await dialog.getByRole("button", { name: "Cancelar" }).click();
      await expect(trigger).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: test.info().outputPath("delete-detail-mobile.png"),
      });
      await trigger.click();
      await page.screenshot({
        path: test.info().outputPath("delete-confirm-mobile.png"),
      });
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await dialog
        .getByRole("button", { name: "Eliminar", exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toContainText(
        "La ejecución se conserva; puedes reintentar",
      );
      expect(factory.view(run.id)).not.toBeNull();
      expect(existsSync(join(s.config.dataDir, "workspaces", run.id))).toBe(
        false,
      );
      rmSync(blocked, { recursive: true });
      await dialog
        .getByRole("button", { name: "Eliminar", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Ejecuciones", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Ejecuciones", exact: true }),
      ).toBeFocused();
      await expect(page.getByRole("button", { name: run.task })).toHaveCount(0);
      expect(factory.view(run.id)).toBeNull();
      expect(factory.view(other.id)).not.toBeNull();
      expect(existsSync(join(s.config.dataDir, "conversations", run.id))).toBe(
        false,
      );
      await page.getByRole("button", { name: other.task }).click();
      await expect(
        page.getByRole("heading", { name: other.task }),
      ).toBeVisible();
      await expect(trigger).toHaveCount(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      factory.close();
      rmSync(s.root, { recursive: true, force: true });
    }
  });
}

test("el Dashboard bloquea envíos repetidos y Escape mientras espera el borrado", async ({
  page,
}) => {
  const s = setup();
  const factory = createFactory(s.config, s.agent);
  const run = await factory.run("Una sola eliminación");
  await factory.stop(run.id);
  const server = panelServer(factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route(`**/api/runs/${run.id}`, async (route) => {
    requests++;
    await pending;
    await route.continue();
  });
  try {
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Eliminar ejecución", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Eliminar ejecución" });
    await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Eliminando…" }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Cancelar" }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    release();
    await expect(
      page.getByRole("heading", { name: "Todo empieza con una petición" }),
    ).toBeVisible();
    expect(requests).toBe(1);
    expect(factory.view(run.id)).toBeNull();
  } finally {
    release();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    factory.close();
    rmSync(s.root, { recursive: true, force: true });
  }
});
