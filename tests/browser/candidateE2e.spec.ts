import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { verificationFixture } from "../support/verification.ts";

for (const scenario of ["passed", "occupied", "cancelled"] as const) {
  test(`E2E del candidato: ${{ passed: "superado", occupied: "ocupado", cancelled: "cancelado" }[scenario]}`, async () => {
    test.setTimeout(60_000);
    const occupied = scenario === "occupied";
    const server = createServer((_req, response) =>
      response.end("Unrelated server"),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const command = `node '${resolve("node_modules/@playwright/test/cli.js")}' test --config config/playwright.config.mjs`;
    const origin = `http://127.0.0.1:${port}`;
    const serverCommand = "node server.mjs";
    const s = verificationFixture({
      commands: ["node build.mjs", command],
      e2e: {
        command,
        configFile: "config/playwright.config.mjs",
        serverCommand,
        origin,
        serves: "dist",
        reuseExistingServer: false,
        offline: false,
      },
      files: {
        ".gitignore": "dist/\ntest-results/\nserver.pid\nrunning.pid\n",
        "server.mjs": `import {createServer} from 'node:http'; import {readFileSync,writeFileSync} from 'node:fs';writeFileSync('server.pid',String(process.pid));createServer((_req,res)=>res.end(readFileSync('dist/index.html'))).listen(${port},'127.0.0.1');`,
        "config/setup.mjs":
          "export default () => { console.log('GLOBAL SETUP OBSERVED'); };",
        "build.mjs":
          "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'; mkdirSync('dist',{recursive:true});writeFileSync('dist/index.html', '<h1>'+readFileSync('catalogue.txt','utf8')+'</h1><h2>Stable catalogue</h2>');",
        "config/playwright.config.mjs": `import {fileURLToPath} from 'node:url'; const root=fileURLToPath(new URL('..',import.meta.url)); export default { globalSetup: './setup.mjs', testDir: '../tests/e2e', snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}', expect: { toMatchAriaSnapshot: { pathTemplate: '../tests/e2e/snapshots/{arg}{ext}' } }, use: { browserName: 'chromium', channel: 'chrome', baseURL: '${origin}' }, webServer: { cwd: root, command: '${serverCommand}', url: '${origin}', reuseExistingServer: false }, reporter: 'list' };`,
        "tests/e2e/snapshots/stable.txt": "stable",
        "tests/e2e/snapshots/stable.aria.yml":
          '- heading "Stable catalogue" [level=2]\n',
        "tests/e2e/catalogue.spec.mjs": `import { test, expect } from '${resolve("node_modules/@playwright/test/index.mjs")}'; test('catalogue build', async ({page, browser}) => {await page.goto('/'); await expect(page.locator('h1')).toContainText('catalogue'); expect('stable').toMatchSnapshot('stable.txt'); await expect(page.locator('h2')).toMatchAriaSnapshot({name:'stable.aria.yml'}); console.log('SERVED: ' + await page.locator('h1').textContent()); console.log('BROWSER VERSION: ' + browser.version()); const fs=await import('node:fs'); if(fs.existsSync('cancel.flag')) {fs.writeFileSync('running.pid',String(process.pid)); await new Promise(()=>{});} if((await page.locator('h1').textContent()).includes('Candidate')) await test.info().attach('native attachment',{body:Buffer.from('password=native-pretend-secret'),contentType:'text/plain'});});`,
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
      if (scenario === "cancelled") {
        s.commit("cancel.flag", "cancel", "Observe cancellation");
      }
      s.finish();
      const verification = s.workflow.verifyCandidate();
      if (scenario === "cancelled") {
        const path = join(s.directory, "running.pid");
        for (let count = 0; count < 500 && !existsSync(path); count++) {
          await delay(10);
        }
        expect(existsSync(path), "Real candidate browser test started").toBe(
          true,
        );
        const runnerPid = Number(readFileSync(path, "utf8"));
        const serverPid = Number(
          readFileSync(join(s.directory, "server.pid"), "utf8"),
        );
        const stopped = await s.workflow.stop(s.workflow.factory.active!);
        expect(stopped.status, stopped.error ?? "").toBe("stopped");
        expect(stopped.verification?.effectsUncertain).not.toBe(true);
        expect(() => process.kill(runnerPid, 0)).toThrow();
        expect(() => process.kill(serverPid, 0)).toThrow();
        expect(s.workflow.factory.active).toBe(null);
        await verification;
        return;
      }
      const result = (await verification)!;
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
        expect(output).toContain("GLOBAL SETUP OBSERVED");
        expect(output).toContain("Native attachment removed");
        expect(output).not.toContain(
          Buffer.from("password=native-pretend-secret").toString("base64"),
        );
        expect(
          existsSync(
            join(
              s.config.dataDir,
              "workspaces",
              "verification-playwright-output",
            ),
          ),
        ).toBe(false);
        const wrapper =
          result.verification!.checks[1].executedCommand!.match(
            /--config '([^']+)'$/,
          )![1];
        expect(existsSync(wrapper)).toBe(false);
        expect(result.verification?.checks[1].pid).toBeGreaterThan(0);
      }
    } finally {
      server.closeAllConnections();
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      s.close();
    }
  });
}
