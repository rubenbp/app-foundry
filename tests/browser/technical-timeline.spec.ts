import { test, expect } from "@playwright/test";
import { timelineFixture } from "../support/timeline.ts";

test("operaciones técnicas directas, fallos y registro íntegro conservan etiquetas y geometría", async ({
  page,
}) => {
  const fixture = await timelineFixture(page);
  try {
    fixture.emit({ type: "status", status: "session.busy" });
    fixture.emit({ type: "status", status: "session.idle" });
    fixture.part("activity", "Una actividad corta el tramo técnico");
    fixture.advance();
    fixture.emit({ type: "status", status: "session.tool.failed" });
    fixture.advance();
    fixture.emit({ type: "status", status: "session.observed" });
    await fixture.open();
    const timeline = page.getByRole("list", {
      name: "Cronología",
      exact: true,
    });
    await expect(timeline).toContainText("session.tool.failed");
    await expect(timeline).not.toContainText("Crear la sesión de OpenCode");
    await page.getByRole("checkbox", { name: "Registro técnico" }).check();
    const title = timeline.getByText("Crear la sesión de OpenCode", {
      exact: true,
    });
    await expect(title).toBeVisible();
    const operation = timeline.getByRole("listitem").filter({
      has: page.getByText("Crear la sesión de OpenCode", { exact: true }),
    });
    await expect(
      operation.getByText("Confirmada", { exact: true }),
    ).toBeVisible();
    const detail = operation.getByText("Detalle de la operación", {
      exact: true,
    });
    await detail.focus();
    await page.keyboard.press("Enter");
    await expect(operation.locator("details")).toHaveAttribute("open", "");
    await expect(operation).toContainText("Create OpenCode session");
    await expect(operation).toContainText("OpenCode session created");
    await expect(operation).not.toContainText(
      "Confirmación / última observación",
    );
    await expect(operation).not.toContainText("Registros de origen");
    await expect(
      page.getByText(/entradas visibles · \d+ registros de origen/),
    ).toBeVisible();
    await expect(timeline.locator(":scope > li").last()).toHaveClass(
      /entry-technical/,
    );
    const geometry = await timeline.evaluate((element) => {
      const rows = [...element.children] as HTMLElement[];

      return rows.map((row) => {
        const style = getComputedStyle(row);
        const time = row.querySelector("time")!.getBoundingClientRect();
        const icon = row
          .querySelector(".entry-label > span")!
          .getBoundingClientRect();

        return {
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          time: time.top,
          icon: icon.top,
          left: icon.left,
        };
      });
    });
    expect(
      geometry.every(
        ({ paddingTop, paddingBottom }) => paddingTop === paddingBottom,
      ),
    ).toBe(true);
    expect(geometry.every(({ time, icon }) => Math.abs(time - icon) < 1)).toBe(
      true,
    );
    expect(new Set(geometry.map(({ left }) => left)).size).toBe(1);
    await page.getByText("Ver registro original", { exact: true }).click();
    const original = page.getByRole("region", {
      name: "Registro original",
      exact: true,
    });
    await expect(original.locator(".original-history > li")).toHaveCount(
      fixture.factory.view(fixture.run.id)!.history.length,
    );
    await expect(
      original.getByRole("link", { name: "activity", exact: true }),
    ).toBeVisible();
  } finally {
    await fixture.close();
  }
});

test("una confirmación actualiza la misma operación sin cerrar su detalle, mover la lectura ni duplicar novedades", async ({
  page,
}) => {
  const fixture = await timelineFixture(page);
  try {
    await page.clock.install({ time: 1_800_000_000_000 });
    const key = `push:${"b".repeat(40)}`;
    const start = fixture.factory.view(fixture.run.id)!;
    fixture.factory.record(start, "intent", key);
    fixture.factory.persist(start);
    for (let index = 0; index < 28; index++) {
      fixture.part(`message-${index}`, `Mensaje ${index}`);
    }
    await fixture.open();
    await page.getByRole("checkbox", { name: "Registro técnico" }).check();
    await page
      .getByRole("button", { name: "Consultar desde el inicio" })
      .click();
    const row = page.locator(".timeline > .timeline-entry").filter({
      has: page.getByText("Publicar el Commit candidato en GitHub", {
        exact: true,
      }),
    });
    await row.getByText("Detalle de la operación", { exact: true }).click();
    await expect(
      row.getByText("Intención sin confirmar", { exact: true }),
    ).toBeVisible();
    const before = await row.evaluate((element) => ({
      id: element.getAttribute("data-entry-id"),
      top:
        element.getBoundingClientRect().top -
        document.querySelector(".timeline-viewport")!.getBoundingClientRect()
          .top,
    }));
    const observed = fixture.factory.view(fixture.run.id)!;
    fixture.factory.record(observed, "confirmed", key);
    fixture.factory.persist(observed);
    await page.clock.runFor(2200);
    await expect(row.getByText("Confirmada", { exact: true })).toBeVisible();
    await expect(row.locator("details")).toHaveAttribute("open", "");
    await expect(row.locator(".technical-records > li")).toHaveCount(2);
    await expect(page.getByText("1 novedad", { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        row.evaluate(
          (element) =>
            element.getBoundingClientRect().top -
            document
              .querySelector(".timeline-viewport")!
              .getBoundingClientRect().top,
        ),
      )
      .toBeCloseTo(before.top, 0);
    await expect(row).toHaveAttribute("data-entry-id", before.id!);
    await page.clock.runFor(4200);
    await expect(page.getByText("1 novedad", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "Registro técnico" }).uncheck();
    await expect(page.getByText("0 novedades", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "Registro técnico" }).check();
    await expect(page.getByText("1 novedad", { exact: true })).toBeVisible();
    await expect(row.locator("details")).toHaveAttribute("open", "");
  } finally {
    await fixture.close();
  }
});
