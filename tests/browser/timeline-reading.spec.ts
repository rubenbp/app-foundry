import { test, expect, type Page } from "@playwright/test";
import { timelineFixture } from "../support/timeline.ts";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

function viewport(page: Page) {
  return page.getByRole("region", { name: "Entradas de la cronología" });
}

async function bottomDistance(page: Page) {
  return viewport(page).evaluate(
    (element) =>
      element.scrollHeight - element.clientHeight - element.scrollTop,
  );
}

async function settleScroll(page: Page) {
  let previous = -1;
  let stable = 0;
  await expect
    .poll(
      async () => {
        const top = await viewport(page).evaluate(
          (element) => element.scrollTop,
        );
        stable = top === previous ? stable + 1 : 0;
        previous = top;

        return stable;
      },
      { intervals: [100, 100, 100] },
    )
    .toBeGreaterThanOrEqual(2);
}

async function readingPoint(page: Page) {
  return viewport(page).evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const row = [
      ...element.querySelectorAll<HTMLElement>("[data-entry-id]"),
    ].find((entry) => entry.getBoundingClientRect().bottom > top)!;

    return {
      id: row.dataset.entryId!,
      offset: row.getBoundingClientRect().top - top,
    };
  });
}

async function expectPoint(page: Page, point: { id: string; offset: number }) {
  await expect
    .poll(() =>
      viewport(page).evaluate((element, id) => {
        const row = [
          ...element.querySelectorAll<HTMLElement>("[data-entry-id]"),
        ].find((entry) => entry.dataset.entryId === id)!;

        return (
          row.getBoundingClientRect().top - element.getBoundingClientRect().top
        );
      }, point.id),
    )
    .toBeCloseTo(point.offset, 0);
}

test("seguir el final y leer el pasado conserva la entrada y cuenta cambios únicos", async ({
  page,
}) => {
  const fixture = await timelineFixture(page);
  try {
    await page.clock.install({ time: 1_800_000_000_000 });
    for (let index = 0; index < 35; index++) {
      fixture.part(`message-${index}`, `Mensaje ${index}`);
    }
    await fixture.open();
    await expect(
      page.getByText("Siguiendo la actividad", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1);
    const region = viewport(page);
    await region.hover();
    await page.mouse.wheel(0, -700);
    await expect(
      page.getByText("Leyendo el historial", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => bottomDistance(page)).toBeGreaterThan(500);
    await settleScroll(page);
    const point = await readingPoint(page);
    fixture.part("new-one", "Una nueva observación");
    fixture.part("message-0", "Mensaje inicial actualizado y reordenado");
    await page.clock.runFor(2200);
    await expect(page.getByText("2 novedades", { exact: true })).toBeVisible();
    await expectPoint(page, point);
    fixture.part(point.id.slice(5), "La entrada anclada también se actualiza");
    await page.clock.runFor(2200);
    await expectPoint(page, point);
    await expect(page.getByText("3 novedades", { exact: true })).toBeVisible();
    fixture.part("new-one", "Streaming de la misma entrada");
    await page.clock.runFor(2200);
    await expect(page.getByText("3 novedades", { exact: true })).toBeVisible();
    await expectPoint(page, point);
    await page.clock.runFor(4200);
    await expect(page.getByText("3 novedades", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Volver al final" }).click();
    await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1);
    fixture.part("last", "Último contenido");
    await page.clock.runFor(2200);
    await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1);
    await expect(
      page.getByText("Siguiendo la actividad", { exact: true }),
    ).toBeVisible();
  } finally {
    await fixture.close();
  }
});

test("teclado, filtros y resize conservan la lectura; alcanzar el final a mano recupera el seguimiento", async ({
  page,
}) => {
  const fixture = await timelineFixture(page);
  try {
    await page.clock.install({ time: 1_800_000_000_000 });
    for (let index = 0; index < 28; index++) {
      fixture.part(`entry-${index}`, `Mensaje ${index}`);
    }
    await fixture.open();
    const region = viewport(page);
    await region.focus();
    await page.keyboard.press("PageUp");
    await expect(
      page.getByText("Leyendo el historial", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => bottomDistance(page)).toBeGreaterThan(100);
    await settleScroll(page);
    const point = await readingPoint(page);
    await page.getByRole("checkbox", { name: "Registro técnico" }).check();
    await expectPoint(page, point);
    await expect(page.getByText("0 novedades", { exact: true })).toBeVisible();
    await page.clock.runFor(2200);
    await expect(page.getByText("0 novedades", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "Registro técnico" }).uncheck();
    await expectPoint(page, point);
    await page.setViewportSize({ width: 1000, height: 810 });
    await expectPoint(page, point);
    fixture.part("after-resize", "Nueva entrada tras el resize");
    await page.clock.runFor(2200);
    await expectPoint(page, point);
    await expect(page.getByText("1 novedad", { exact: true })).toBeVisible();
    await region.focus();
    await page.keyboard.press("End");
    await expect(
      page.getByText("Siguiendo la actividad", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1);
    fixture.part("after-end", "Continuación después del final manual");
    await page.clock.runFor(2200);
    await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1000, height: 680 });
    await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1);
    await page
      .getByRole("button", { name: "Consultar desde el inicio" })
      .click();
    await expect(
      page.getByText("Leyendo el historial", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => region.evaluate((element) => element.scrollTop))
      .toBe(0);
    const footer = page.getByLabel("Seguimiento de la cronología", {
      exact: true,
    });
    const geometry = await footer.evaluate((element) => {
      const scroll = document.querySelector(".timeline-viewport")!;

      return {
        inside: scroll.contains(element),
        bottom: element.getBoundingClientRect().bottom,
        height: innerHeight,
      };
    });
    expect(geometry.inside).toBe(false);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
  } finally {
    await fixture.close();
  }
});

test("abrir una salida pausa y conserva el ancla ante carga tardía, streaming y reordenación", async ({
  page,
}) => {
  const fixture = await timelineFixture(page);
  try {
    await page.clock.install({ time: 1_800_000_000_000 });
    fixture.part("slow", "Contenido tardío\n".repeat(45));
    for (let index = 0; index < 30; index++) {
      fixture.part(`message-${index}`, `Mensaje ${index}`);
    }
    await fixture.open();
    await page
      .getByRole("button", { name: "Consultar desde el inicio" })
      .click();
    let release: () => void = () => {};
    await page.route("**/outputs/slow", async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.continue();
    });
    await page.locator("#output-toggle-slow").click();
    await expect(
      page.getByText("Cargando salida…", { exact: true }),
    ).toBeVisible();
    await viewport(page).hover();
    await page.mouse.wheel(0, 650);
    await expect
      .poll(() => viewport(page).evaluate((element) => element.scrollTop))
      .toBeGreaterThan(500);
    await settleScroll(page);
    const point = await readingPoint(page);
    release();
    await expect(page.locator("#output-slow")).toContainText(
      "Contenido tardío",
    );
    await expectPoint(page, point);
    await page.unroute("**/outputs/slow");
    fixture.part("slow", "Contenido actualizado\n".repeat(60));
    await page.clock.runFor(2200);
    await expect(page.locator("#output-slow")).toContainText(
      "Contenido actualizado",
    );
    await expectPoint(page, point);
    await expect(page.locator("#output-toggle-slow")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(
      page.getByText("Leyendo el historial", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("1 novedad", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Volver al final" }).click();
    await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1);
    let releaseFollowing: () => void = () => {};
    await page.route("**/outputs/slow", async (route) => {
      await new Promise<void>((resolve) => {
        releaseFollowing = resolve;
      });
      await route.continue();
    });
    fixture.part("slow", "Streaming con seguimiento activo\n".repeat(70));
    await page.clock.runFor(2200);
    await expect(
      page.getByText("Cargando salida…", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1);
    releaseFollowing();
    await expect(page.locator("#output-slow")).toContainText(
      "Streaming con seguimiento activo",
    );
    await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1);
    await expect(
      page.getByText("Siguiendo la actividad", { exact: true }),
    ).toBeVisible();
    await page.unroute("**/outputs/slow");
    await page.locator("#output-toggle-slow").click();
    await page.locator("#output-toggle-slow").click();
    await expect(
      page.getByText("Leyendo el historial", { exact: true }),
    ).toBeVisible();
    fixture.part("slow", "x");
    await page.clock.runFor(2200);
    await expect(page.locator("#output-slow")).toHaveText("x");
    await expect(
      page.getByText("Leyendo el historial", { exact: true }),
    ).toBeVisible();
    await viewport(page).hover();
    await page.mouse.wheel(0, 1000);
    await expect(
      page.getByText("Siguiendo la actividad", { exact: true }),
    ).toBeVisible();
  } finally {
    await fixture.close();
  }
});

test("los registros revelados por filtro no son novedades y cada selección inicia su propio seguimiento", async ({
  page,
}) => {
  const fixture = await timelineFixture(page);
  try {
    await page.clock.install({ time: 1_800_000_000_000 });
    for (let index = 0; index < 25; index++) {
      fixture.part(`old-${index}`, `Observación anterior ${index}`);
    }
    await fixture.open();
    await page
      .getByRole("button", { name: "Consultar desde el inicio" })
      .click();
    fixture.emit({ type: "status", status: "session.observed" });
    await page.clock.runFor(2200);
    await expect(page.getByText("0 novedades", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "Registro técnico" }).check();
    await expect(page.getByText("0 novedades", { exact: true })).toBeVisible();
    await page.clock.runFor(2200);
    await expect(page.getByText("0 novedades", { exact: true })).toBeVisible();
    fixture.part("new-old-run", "Observación nueva de la primera Ejecución");
    await page.clock.runFor(2200);
    await expect(page.getByText("1 novedad", { exact: true })).toBeVisible();
    await fixture.factory.stop(fixture.run.id);
    await fixture.factory.run("Segunda Ejecución independiente");
    fixture.part("second", "Observación de la segunda Ejecución");
    await page.clock.runFor(2200);
    await expect(
      page.getByRole("heading", {
        name: "Segunda Ejecución independiente",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Siguiendo la actividad", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("#part-old-0")).toHaveCount(0);
    await expect(
      page.getByRole("checkbox", { name: "Registro técnico" }),
    ).not.toBeChecked();
    await page
      .getByRole("button", { name: /Relacionar actividad y evidencia/ })
      .click();
    await expect(page.locator("#part-old-0")).toHaveCount(1);
    await expect(
      page.getByText("Siguiendo la actividad", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1);
  } finally {
    await fixture.close();
  }
});

test.describe("gestos táctiles", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("subir con el dedo pausa y conserva el contenido visible al recibir actividad", async ({
    page,
  }) => {
    const fixture = await timelineFixture(page);
    try {
      await page.clock.install({ time: 1_800_000_000_000 });
      for (let index = 0; index < 25; index++) {
        fixture.part(`touch-${index}`, `Mensaje táctil ${index}`);
      }
      await fixture.open();
      await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1);
      const bounds = await viewport(page).boundingBox();
      if (!bounds) {
        throw new Error("Missing timeline viewport");
      }
      const session = await page.context().newCDPSession(page);
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + 35;
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (const distance of [35, 75, 120, 170]) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y + distance }],
        });
      }
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(
        page.getByText("Leyendo el historial", { exact: true }),
      ).toBeVisible();
      await expect.poll(() => bottomDistance(page)).toBeGreaterThan(50);
      await settleScroll(page);
      const point = await readingPoint(page);
      fixture.part("touch-new", "Actividad recibida mientras se lee en móvil");
      await page.clock.runFor(2200);
      await expectPoint(page, point);
      await expect(page.getByText("1 novedad", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Volver al final" }).click();
      await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1);
      await session.detach();
    } finally {
      await fixture.close();
    }
  });
});

test.describe("scrollbar nativo", () => {
  test("arrastrar el scrollbar pausa sin confundir un clic en una entrada con lectura", async ({
    page,
  }) => {
    const fixture = await timelineFixture(page);
    try {
      await page.clock.install({ time: 1_800_000_000_000 });
      for (let index = 0; index < 35; index++) {
        fixture.part(`scrollbar-${index}`, `Mensaje ${index}`);
      }
      await fixture.open();
      await expect.poll(() => bottomDistance(page)).toBeLessThanOrEqual(1);
      await page.locator(".timeline .entry-label").last().click();
      await expect(
        page.getByText("Siguiendo la actividad", { exact: true }),
      ).toBeVisible();
      const track = await viewport(page).evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const thumb = Math.max(
          30,
          element.clientHeight ** 2 / element.scrollHeight,
        );

        return {
          x: bounds.right - 7,
          y: bounds.bottom - thumb / 2,
          target: bounds.y + bounds.height / 2,
        };
      });
      await page.mouse.move(track.x, track.y);
      await page.mouse.down();
      await page.mouse.move(track.x, track.target, { steps: 10 });
      await page.mouse.up();
      await expect(
        page.getByText("Leyendo el historial", { exact: true }),
      ).toBeVisible();
      await expect.poll(() => bottomDistance(page)).toBeGreaterThan(100);
      await settleScroll(page);
      const point = await readingPoint(page);
      fixture.part("after-scrollbar", "Entrada durante consulta con scrollbar");
      await page.clock.runFor(2200);
      await expectPoint(page, point);
      await expect(page.getByText("1 novedad", { exact: true })).toBeVisible();
    } finally {
      await fixture.close();
    }
  });
});
