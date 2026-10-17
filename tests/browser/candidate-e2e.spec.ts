import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { verificationFixture } from "../support/verification.ts";

for (const occupied of [false, true]) {
  test(`candidate E2E ${occupied ? "refuses an existing server" : "serves its own compiled tree and records the real browser"}`, async () => {
    test.setTimeout(60_000);
    const server = createServer((_req, response) =>
      response.end("Unrelated server"),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const command = `node '${resolve("node_modules/@playwright/test/cli.js")}' test`;
    const origin = `http://127.0.0.1:${port}`;
    const serverCommand = `python3 -m http.server ${port} --bind 127.0.0.1 --directory dist`;
    const s = verificationFixture({
      commands: ["node build.mjs", command],
      e2e: {
        command,
        configFile: "playwright.config.mjs",
        serverCommand,
        origin,
        serves: "dist",
        reuseExistingServer: false,
        offline: false,
      },
      files: {
        ".gitignore": "dist/\ntest-results/\n",
        "build.mjs":
          "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'; mkdirSync('dist',{recursive:true});writeFileSync('dist/index.html', '<h1>'+readFileSync('catalogue.txt','utf8')+'</h1>');",
        "playwright.config.mjs": `export default { testDir: './tests/e2e', use: { browserName: 'chromium', channel: 'chrome', baseURL: '${origin}' }, webServer: { command: '${serverCommand}', url: '${origin}', reuseExistingServer: false }, reporter: 'list' };`,
        "tests/e2e/catalogue.spec.mjs": `import { test, expect } from '${resolve("node_modules/@playwright/test/index.mjs")}'; test('catalogue build', async ({page, browser}) => {await page.goto('/'); await expect(page.locator('h1')).toContainText('catalogue'); console.log('SERVED: ' + await page.locator('h1').textContent()); console.log('BROWSER VERSION: ' + browser.version());});`,
      },
    });
    try {
      await s.start();
      s.commit(
        "catalogue.txt",
        "Candidate catalogue",
        "Change full candidate tree",
      );
      if (occupied) {
        server.listen(port, "127.0.0.1");
        await once(server, "listening");
      }
      s.finish();
      const result = (await s.workflow.verifyCandidate())!;
      const output = s.workflow.output(result.id, "verification-check-2");
      if (occupied) {
        expect(result.status).toBe("intervention");
        expect(result.verification?.checks[1].status).toBe("failed");
        expect(output).toContain("already used");
        expect(result.verification?.e2e).toBeUndefined();
      } else {
        expect(result.status, output ?? result.error ?? "").toBe(
          "awaiting_preview",
        );
        expect(result.verification?.e2e).toMatchObject({
          executedTests: 1,
          skippedTests: 0,
          origin,
          serves: "dist",
          reuseExistingServer: false,
          browsers: [{ name: "chromium", channel: "chrome" }],
        });
        expect(output).toContain("SERVED: Candidate catalogue");
        expect(output).toContain("BROWSER VERSION:");
      }
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      s.close();
    }
  });
}
