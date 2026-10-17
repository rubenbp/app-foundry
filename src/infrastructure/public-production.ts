import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import type { PublicationContext } from "../application/publication.ts";
import type { PublicCheck, PublicEvidence } from "../domain/production.ts";

// A fresh browser has no user credentials. Only public, read-only requests to
// the configured origin are allowed; candidate scripts cannot probe local hosts.
export async function verifyPublicProduction(
  root: string,
  context: PublicationContext,
  integratedSha: string,
  checks: PublicCheck[],
  launchBrowser = () => chromium.launch({ channel: "chrome", headless: true }),
): Promise<PublicEvidence> {
  const origin = context.project.publication.productionOrigin;
  const browser = await launchBrowser();
  try {
    const session = await browser.newContext({ serviceWorkers: "block" });
    const page = await session.newPage();
    page.setDefaultTimeout(10_000);
    await session.route("**/*", (route) => {
      const request = route.request();

      return new URL(request.url()).origin === origin &&
        ["GET", "HEAD"].includes(request.method())
        ? route.continue()
        : route.abort();
    });
    await session.routeWebSocket("**/*", (socket) => socket.close());
    const markerPath =
      context.project.publication.versionPath ?? "/version.json";
    if (
      typeof markerPath !== "string" ||
      !/^\/[\w./-]+$/.test(markerPath) ||
      markerPath.includes("..")
    )
      throw new Error("Invalid trusted production version path");
    const markerPage = await session.newPage();
    const marker = async () => {
      const response = await markerPage.goto(`${origin}${markerPath}`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      if (
        !response ||
        response.status() !== 200 ||
        markerPage.url() !== `${origin}${markerPath}` ||
        response.request().redirectedFrom()
      )
        throw new Error(
          `Public version HTTP ${response?.status() ?? "unavailable"} or redirect; publication unverified`,
        );
      const raw = await response.body();
      if (raw.length > 65_536)
        throw new Error("Public version response too large");
      const value: unknown = JSON.parse(raw.toString());
      if (
        !value ||
        typeof value !== "object" ||
        !("sha" in value) ||
        value.sha !== integratedSha ||
        ("dirty" in value && value.dirty === true)
      )
        throw new Error(
          "Public version does not match integrated SHA or serves a dirty build",
        );
      return integratedSha;
    };
    const evidence: PublicEvidence = {
      origin,
      servedHead: null,
      browser: `Google Chrome ${browser.version()} · public · online`,
      checks: [],
      screenshots: [],
    };
    try {
      evidence.servedHead = await marker();
      const directory = join(
        root,
        "production",
        createHash("sha256").update(context.runId).digest("hex"),
        integratedSha,
      );
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      for (const [index, check] of checks.entries()) {
        const response = await page.goto(`${origin}${check.path}`, {
          waitUntil: "networkidle",
          timeout: 20_000,
        });
        if (
          !response ||
          response.status() !== 200 ||
          page.url() !== `${origin}${check.path}` ||
          response.request().redirectedFrom() !== null
        )
          throw new Error(
            `Public page ${check.path} unavailable or redirected to ${page.url()}`,
          );
        const element = page.locator(check.selector);
        const count = await element.count();
        const visible = count === 1 && (await element.isVisible());
        const observedText = visible
          ? (await element.innerText()).replace(/\s+/g, " ").trim()
          : `Visible matches: ${visible ? count : 0}`;
        const href = visible ? await element.getAttribute("href") : null;
        let passed =
          visible &&
          (check.text === undefined ||
            observedText === check.text.replace(/\s+/g, " ").trim()) &&
          (check.href === undefined || href === check.href);
        let followed = "";
        if (passed && check.follow) {
          const [navigation] = await Promise.all([
            page.waitForResponse(
              (response) =>
                response.request().isNavigationRequest() &&
                response.url() === `${origin}${check.href}`,
              { timeout: 10_000 },
            ),
            page.waitForURL(
              (url) =>
                url.origin === origin &&
                url.pathname.replace(/\/$/, "") ===
                  check.href!.replace(/\/$/, ""),
              { timeout: 10_000 },
            ),
            element.click(),
          ]);
          passed = navigation.status() === 200;
          followed = `; navigation ${new URL(page.url()).pathname}: HTTP ${navigation.status()}`;
        }
        evidence.checks.push({
          check,
          observed: `${observedText.slice(0, 4000)}${check.href ? `; href=${href}` : ""}${followed}`,
          passed,
        });
        const screenshot = join(
          directory,
          `criterion-${check.criterion}-${index + 1}.png`,
        );
        await page.screenshot({ path: screenshot, fullPage: true });
        evidence.screenshots.push(screenshot);
      }
      // Observe the alias again after all behavior checks; an alias switch cannot
      // be accredited using a marker read only before navigation.
      await marker();
    } catch (error) {
      evidence.error = String(error);
    }
    return evidence;
  } finally {
    await browser.close();
  }
}
