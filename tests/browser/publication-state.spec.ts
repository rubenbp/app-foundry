import { test, expect, type Page } from "@playwright/test";
import { once } from "node:events";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import { publicationFixture } from "../support/publication.ts";
import type { Run } from "../../src/domain/run.ts";

async function reviewFixture(page: Page) {
  const fixture = publicationFixture();
  const initial = await fixture.candidate();
  await fixture.workflow.poll();
  const run = fixture.workflow.view(initial.id)!;
  const server = panelServer(fixture.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    ...fixture,
    run,
    async open() {
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      );
    },
    retain(change: (run: Run) => void) {
      change(run);
      fixture.workflow.factory.store.save(run);
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fixture.close();
    },
  };
}

test("la revisión compacta enlaza la preview comprobada, el Commit candidato y solo su informe de GitHub", async ({
  page,
}) => {
  const fixture = await reviewFixture(page);
  try {
    fixture.retain((run) => {
      run.publication!.report = {
        id: "report-current",
        head: run.publication!.head,
        url: `${fixture.facts.pull!.url}#issuecomment-51`,
        at: 1_800_000_000_000,
        preview: fixture.facts.preview!.url!,
      };
    });
    fixture.project.publication.projectId = "changed-after-admission";
    await fixture.open();
    const review = page.getByRole("region", {
      name: "Preview y aceptación",
      exact: true,
    });
    await expect(
      review.getByRole("heading", { name: "Preview", exact: true }),
    ).toBeVisible();
    await expect(review.getByText("Disponible", { exact: true })).toBeVisible();
    await expect(
      review.getByRole("link", { name: "Abrir preview ↗", exact: true }),
    ).toHaveAttribute("href", fixture.facts.preview!.url!);
    await expect(
      review.getByRole("link", {
        name: `${fixture.run.publication!.head.slice(0, 7)} ↗`,
        exact: true,
      }),
    ).toHaveAttribute(
      "href",
      `https://github.com/${fixture.run.request!.repository}/commit/${fixture.run.publication!.head}`,
    );
    await expect(
      review.getByRole("link", { name: "Informe en GitHub ↗", exact: true }),
    ).toHaveAttribute("href", `${fixture.facts.pull!.url}#issuecomment-51`);
    await expect(
      review.getByText(fixture.run.publication!.head, { exact: true }).first(),
    ).not.toBeVisible();
    await review
      .getByText("Detalles de publicación e historial", { exact: true })
      .click();
    await expect(
      review.getByText(fixture.run.publication!.head, { exact: true }).first(),
    ).toBeVisible();
    fixture.retain((run) => {
      run.publication!.report!.head = "b".repeat(40);
    });
    await expect(
      review.getByRole("link", { name: "Informe en GitHub ↗", exact: true }),
    ).toHaveCount(0);
  } finally {
    await fixture.close();
  }
});

test("la preview conserva su estado en cabecera, revisión y diálogo; los fallos siguen visibles al consultar el pasado", async ({
  page,
}) => {
  const fixture = await reviewFixture(page);
  try {
    await fixture.open();
    const review = page.getByRole("region", {
      name: "Preview y aceptación",
      exact: true,
    });
    const header = page.getByRole("region", {
      name: "Publicación actual",
      exact: true,
    });
    const retained = structuredClone(fixture.run.publication!.preview!);
    const cases = [
      { change: {}, label: "Disponible" },
      { change: { access: "protected" as const }, label: "Acceso protegido" },
      { change: { state: "pending" as const }, label: "Deployment pendiente" },
      { change: { state: "failure" as const }, label: "Deployment fallido" },
      { change: { state: "error" as const }, label: "Error de deployment" },
      {
        change: { state: "inactive" as const },
        label: "Deployment inactivo; no acredita un fallo de build",
      },
      { change: { servedHead: "b".repeat(40) }, label: "Otra versión" },
    ];
    for (const scenario of cases) {
      fixture.retain((run) => {
        run.publication!.preview = { ...retained, ...scenario.change };
      });
      await expect(
        review.getByText(scenario.label, { exact: true }),
      ).toBeVisible();
      await expect(header).toContainText(`Preview: ${scenario.label}`);
    }
    fixture.retain((run) => {
      run.publication!.observationError = "GitHub unavailable";
      run.publication!.blocked = "Se requiere recuperar el acceso autorizado.";
    });
    await expect(page.locator(".alerts")).toContainText("GitHub unavailable");
    await expect(page.locator(".alerts")).toContainText(
      "Se requiere recuperar el acceso autorizado.",
    );
    await expect(page.locator(".alerts")).toContainText(
      "La preview observada no corresponde al Commit candidato vigente.",
    );
    await page
      .getByRole("navigation", { name: "Fases de la Ejecución" })
      .getByRole("button", { name: /Preparación/ })
      .click();
    await expect(header).toContainText("Preview: Otra versión");
    await expect(page.locator(".alerts")).toContainText("GitHub unavailable");
    await expect(page.locator(".alerts")).toContainText(
      "Se requiere recuperar el acceso autorizado.",
    );
    await expect(page.locator(".alerts")).toContainText(
      "La preview observada no corresponde al Commit candidato vigente.",
    );
    await page
      .getByRole("navigation", { name: "Fases de la Ejecución" })
      .getByRole("button", { name: /Revisión/ })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Consultar contexto" }).click();
    const dialog = page.getByRole("dialog", { name: /Contexto · Revisión/ });
    await expect(dialog).toContainText("Otra versión");
    await expect(dialog).toContainText("GitHub unavailable");
    await expect(dialog).toContainText(
      "Se requiere recuperar el acceso autorizado.",
    );
    await dialog
      .getByText("Detalles de publicación e historial", { exact: true })
      .click();
    await expect(dialog).toContainText("Sin actualizar");
    const blocks = dialog.locator(".publication-block");
    const first = await blocks.nth(0).boundingBox();
    const second = await blocks.nth(1).boundingBox();
    expect(first!.y + first!.height).toBeLessThanOrEqual(second!.y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("publication-states-mobile.png"),
    });
  } finally {
    await fixture.close();
  }
});

test("el cierre distingue aceptación anterior, aceptación vigente y una PR integrada sin aceptación acreditada", async ({
  page,
}) => {
  const fixture = await reviewFixture(page);
  const at = 1_800_000_000_000;
  try {
    fixture.retain((run) => {
      run.publication!.acceptance = {
        author: "reviewer",
        at,
        head: "b".repeat(40),
        preview: fixture.facts.preview!.url!,
      };
    });
    await fixture.open();
    const review = page.getByRole("region", {
      name: "Preview y aceptación",
      exact: true,
    });
    const header = page.getByRole("region", {
      name: "Publicación actual",
      exact: true,
    });
    await page
      .getByRole("navigation", { name: "Fases de la Ejecución" })
      .getByRole("button", { name: /Revisión/ })
      .click();
    await expect(review).toContainText("Aceptación anterior");
    await expect(header).toContainText("Aceptación anterior");
    await expect(
      review.getByText("Aceptación vigente", { exact: true }),
    ).toHaveCount(0);
    fixture.retain((run) => {
      run.publication!.acceptance!.head = run.publication!.head;
    });
    await expect(review).toContainText("Aceptación vigente");
    await expect(header).toContainText("Aceptación vigente");
    await expect(review).toContainText("Aceptado mediante merge por reviewer");
    await expect(review.locator("time")).toHaveAttribute(
      "datetime",
      "2027-01-15T08:00:00.000Z",
    );
    fixture.retain((run) => {
      delete run.publication!.acceptance;
      Object.assign(run.publication!.pull!, {
        merged: true,
        open: false,
        mergedAt: at,
        mergedBy: "merge-operator",
      });
      run.publication!.mergeSha = "a".repeat(40);
      // An incomplete retained record must not invent closure or acceptance from a final status.
      run.status = "completed";
    });
    await expect(review).toContainText("Sin aceptación registrada");
    await expect(review.getByText("Integrada", { exact: true })).toBeVisible();
    await expect(header).toContainText("Sin aceptación registrada");
    await page
      .getByRole("navigation", { name: "Fases de la Ejecución" })
      .getByRole("button", { name: /Cierre/ })
      .click();
    const integration = page.getByRole("region", {
      name: "Integración y cierre",
      exact: true,
    });
    await expect(integration).toContainText("Sin aceptación acreditada");
    await expect(integration).toContainText("Cierre del issue pendiente");
    await expect(integration).toContainText("merge-operator");
    await expect(integration.locator("time").first()).toHaveAttribute(
      "datetime",
      "2027-01-15T08:00:00.000Z",
    );
    await expect(
      integration.getByRole("link", {
        name: `${fixture.run.workspace!.baseSha.slice(0, 7)} ↗`,
      }),
    ).toHaveAttribute(
      "href",
      `https://github.com/${fixture.run.request!.repository}/commit/${fixture.run.workspace!.baseSha}`,
    );
    await expect(
      integration.getByRole("link", { name: "aaaaaaa ↗", exact: true }),
    ).toHaveAttribute(
      "href",
      `https://github.com/${fixture.run.request!.repository}/commit/${"a".repeat(40)}`,
    );
    await expect(integration).toContainText(
      "no acredita una validación de producción",
    );
    fixture.retain((run) => {
      run.publication!.closedAt = at + 60_000;
      run.publication!.acceptance = {
        author: "reviewer",
        at,
        head: run.publication!.head,
        preview: fixture.facts.preview!.url!,
      };
      run.publication!.integrationReport = {
        id: "integration",
        url: `${fixture.facts.pull!.url}#issuecomment-52`,
      };
    });
    await expect(integration).toContainText("Issue cerrado");
    await expect(integration).toContainText("Commit candidato aceptado");
    await expect(
      integration.getByRole("link", {
        name: `${fixture.run.publication!.head.slice(0, 7)} ↗`,
        exact: true,
      }),
    ).toHaveAttribute(
      "href",
      `https://github.com/${fixture.run.request!.repository}/commit/${fixture.run.publication!.head}`,
    );
    await expect(
      integration.getByRole("link", {
        name: "Revisar resumen de integración en GitHub",
        exact: true,
      }),
    ).toHaveAttribute("href", `${fixture.facts.pull!.url}#issuecomment-52`);
  } finally {
    await fixture.close();
  }
});

test("un deployment correcto requiere identidad capturada, Commit servido, URL admitida y acceso comprobado", async ({
  page,
}) => {
  const fixture = await reviewFixture(page);
  try {
    const retained = structuredClone(fixture.run.publication!.preview!);
    await fixture.open();
    const review = page.getByRole("region", {
      name: "Preview y aceptación",
      exact: true,
    });
    const header = page.getByRole("region", {
      name: "Publicación actual",
      exact: true,
    });
    for (const change of [
      { repository: "other/project" },
      { projectId: "other-project" },
      { environment: "Production" },
      { head: "b".repeat(40) },
      { servedHead: null },
      { access: "pending" as const },
      { url: "http://catalogue-unique.vercel.app" },
      { url: "https://user:password@catalogue-unique.vercel.app" },
      { url: "https://catalogue-unique.vercel.app/path" },
      { url: "javascript:alert(1)" },
      { url: "not a URL" },
    ]) {
      fixture.retain((run) => {
        run.publication!.preview = { ...retained, ...change };
      });
      await page.reload();
      await expect(review.getByText("Disponible", { exact: true })).toHaveCount(
        0,
      );
      await expect(header).not.toContainText("Preview: Disponible");
      await expect(
        review.getByRole("link", { name: "Abrir preview ↗", exact: true }),
      ).toHaveCount(0);
      if (change.url) {
        await expect(
          review.getByRole("link", {
            name: "Abrir deployment observado ↗",
            exact: true,
          }),
        ).toHaveCount(0);
      }
      // Read retained detail through the public Dashboard after each observation.
      await review
        .getByText("Detalles de publicación e historial", { exact: true })
        .click();
      if (change.repository) {
        await expect(review).toContainText(change.repository);
      }
      if (change.projectId) {
        await expect(review).toContainText(change.projectId);
      }
      if (change.environment) {
        await expect(review).toContainText(change.environment);
      }
      if (change.head) {
        await expect(review).toContainText(change.head);
      }
      if (change.servedHead === null) {
        await expect(review).toContainText("Sin acreditar");
      }
      if (change.url) {
        await expect(review).toContainText("Sin URL HTTPS admitida");
        await expect(review).not.toContainText("user:password");
      }
      if (change.access) {
        await expect(review).toContainText("Pendiente de comprobar");
      }
      await review
        .getByText("Detalles de publicación e historial", { exact: true })
        .click();
    }
    fixture.retain((run) => {
      delete run.publication!.preview;
    });
    await expect(review.getByText("Pendiente", { exact: true })).toBeVisible();
    await expect(header).toContainText("Preview: Pendiente");
    await expect(
      review.getByRole("link", { name: /Abrir preview|Abrir deployment/ }),
    ).toHaveCount(0);
  } finally {
    await fixture.close();
  }
});
