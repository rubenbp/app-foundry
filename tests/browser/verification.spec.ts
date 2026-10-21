import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import { verificationFixture } from "../support/verification.ts";
import { execute } from "../../src/infrastructure/process.ts";

test("el dashboard muestra la verificación independiente, el diff completo, las comprobaciones y las evidencias de criterios con acceso por teclado", async ({
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
  let commands = 0;
  const s = verificationFixture({
    process: async (command, args, options) => {
      if (
        command === "/bin/sh" &&
        args[1] === "node check.mjs" &&
        ++commands === 2
      ) {
        entered();
        await blocked;
        return {
          code: 7,
          output:
            "Earlier defect <img src=x onerror=alert(1)> password=pretend-panel-secret",
        };
      }
      return execute(command, args, options);
    },
  });
  const run = await s.start();
  s.commit("catalogue.txt", "defect", "Earlier defect");
  s.commit("footer.txt", "Unrelated final change", "Footer");
  const server = panelServer(s.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let verification: ReturnType<typeof s.workflow.verifyCandidate> | undefined;
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    s.finish();
    verification = s.workflow.verifyCandidate();
    await checking;
    await expect(
      page.getByRole("heading", { name: "Verificación independiente" }),
    ).toBeVisible();
    await expect(page.locator(".dashboard-status")).toHaveText(
      "Verificando Commit candidato",
    );
    await expect(
      page
        .getByRole("button", { name: "Verificación", exact: false })
        .filter({ has: page.locator(".dashboard-phase-number") }),
    ).toHaveAttribute("aria-current", "step");
    await page
      .getByRole("button", { name: "Ver evidencia y criterios" })
      .click();
    await expect(
      page.getByRole("region", { name: "Verificación independiente" }),
    ).toContainText("En curso");
    release();
    await verification;
    await expect(page.locator(".dashboard-status.attention")).toHaveText(
      "Requiere atención",
    );
    const section = page.getByRole("region", {
      name: "Verificación independiente",
    });
    await section
      .getByText("Detalles técnicos", { exact: true })
      .first()
      .click();
    await expect(
      section.locator(".verification-check-technical").first(),
    ).toContainText("7");
    await section
      .getByText("Alcance, limitaciones y registro de evidencia", {
        exact: true,
      })
      .click();
    await expect(section).toContainText(s.baseSha);
    await expect(section).toContainText(s.git("rev-parse", "HEAD"));
    await expect(section).toContainText("Keep keyboard navigation.");
    await expect(section).toContainText("Falta evidencia");
    await expect(
      section.getByRole("link", { name: "Revisar cambios en GitHub" }),
    ).toHaveAttribute(
      "href",
      `https://github.com/${s.project.repository}/compare/${s.baseSha}...${s.git("rev-parse", "HEAD")}`,
    );
    const output = page.getByRole("button", {
      name: /\+ node check.mjs · exit 7/,
    });
    await output.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#output-verification-check-1")).toContainText(
      "Earlier defect <img src=x onerror=alert(1)> password=[REDACTED]",
    );
    await expect(page.locator(".output img")).toHaveCount(0);
    await page
      .getByRole("button", { name: /\+ Cumulative candidate diff/ })
      .click();
    await expect(page.locator("#output-verification-diff")).toContainText(
      "+defect",
    );
    await expect(page.locator("#output-verification-diff")).toContainText(
      "+Unrelated final change",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("verification-panel.png"),
      fullPage: true,
    });
    const snapshot = await page.request
      .get(new URL(`/api/view?run=${run.id}`, page.url()).href)
      .then((response) => response.json());
    expect(JSON.stringify(snapshot)).not.toContain("pretend-panel-secret");
  } finally {
    release();
    await verification;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    s.close();
  }
});

test("el dashboard muestra los cambios de configuración como información y conserva el candidato verificado", async ({
  page,
}) => {
  const s = verificationFixture();
  const run = await s.start();
  s.commit("package.json", '{"private":true}', "Update product configuration");
  s.finish();
  await s.workflow.verifyCandidate();
  const server = panelServer(s.workflow.factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    await page
      .getByRole("button", { name: "Ver evidencia y criterios" })
      .click();
    const section = page.getByRole("region", {
      name: "Verificación independiente",
    });
    await expect(
      section.getByRole("heading", {
        name: "Cambios en pruebas o configuración",
      }),
    ).toBeVisible();
    await expect(section).toContainText("package.json");
    await expect(page.locator(".dashboard-status")).toHaveText(
      "Verificado · Preview pendiente",
    );
    await expect(page.locator(".dashboard-status.attention")).toHaveCount(0);
    await expect(section.getByRole("alert")).toHaveCount(0);
    const snapshot = await page.request
      .get(new URL(`/api/view?run=${run.id}`, page.url()).href)
      .then((response) => response.json());
    expect(snapshot.run.verification.status).toBe("passed");
    expect(snapshot.run.verification.controls).toHaveLength(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    s.close();
  }
});
