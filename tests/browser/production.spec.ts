import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:https";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicationFixture } from "../support/publication.ts";
import { verifyPublicProduction } from "../../src/infrastructure/publicProduction.ts";

// Navegador real, límite HTTP público con TLS, Workflow, SQLite y artefactos reales.
// Solo se confía en el certificado temporal de prueba; nunca se desactiva TLS en producción.
for (const scenario of [
  "valid",
  "wrong text",
  "dirty marker",
  "alias changes",
  "page redirects",
] as const) {
  test(`la producción pública (${({ valid: "válida", "wrong text": "texto incorrecto", "dirty marker": "marcador modificado", "alias changes": "cambio de alias", "page redirects": "redirección de página" } as const)[scenario]}): la finalización requiere un comportamiento visible y una versión integrada estable`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "foundry-public-"));
    const key = join(directory, "key.pem");
    const cert = join(directory, "cert.pem");
    const generated = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
      ],
      { encoding: "utf8" },
    );
    expect(generated.status, generated.stderr).toBe(0);
    const pubkey = spawnSync("openssl", [
      "x509",
      "-in",
      cert,
      "-pubkey",
      "-noout",
    ]);
    const der = spawnSync("openssl", ["pkey", "-pubin", "-outform", "DER"], {
      input: pubkey.stdout,
    });
    expect(der.status).toBe(0);
    const fingerprint = createHash("sha256")
      .update(der.stdout)
      .digest("base64");
    let markers = 0;
    const server = createServer(
      { key: readFileSync(key), cert: readFileSync(cert) },
      (req, res) => {
        if (req.url === "/version.json") {
          markers++;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              sha:
                scenario === "alias changes" && markers > 1
                  ? "b".repeat(40)
                  : "a".repeat(40),
              dirty: scenario === "dirty marker",
            }),
          );
        } else if (scenario === "page redirects" && req.url === "/") {
          res.writeHead(302, { Location: "/other/" });
          res.end();
        } else {
          res.setHeader("Content-Type", "text/html");
          res.end(
            `<html><body><nav>Keyboard navigation</nav><h1>${scenario === "wrong text" ? "Wrong catalogue" : "Catalogue"}</h1></body></html>`,
          );
        }
      },
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
    const s = publicationFixture({
      origin,
      verify: (context, head, checks) =>
        verifyPublicProduction(directory, context, head, checks, () =>
          chromium.launch({
            channel: "chrome",
            args: [`--ignore-certificate-errors-spki-list=${fingerprint}`],
          }),
        ),
    });
    try {
      const run = await s.candidate();
      await s.workflow.poll();
      s.comment();
      await s.workflow.poll();
      s.merge();
      s.productionReady();
      await s.workflow.poll();
      const result = s.workflow.view(run.id)!;
      const evidence = result.publication?.production;
      expect(evidence?.evidencePartId).toBeTruthy();
      const output = JSON.parse(
        s.workflow.output(run.id, evidence!.evidencePartId!)!,
      );
      if (scenario === "valid") {
        expect(result.status).toBe("completed");
        expect(
          output.checks.every((check: { passed: boolean }) => check.passed),
        ).toBe(true);
        expect(output.screenshots).toHaveLength(2);
        expect(output.browser).toContain("Google Chrome");
      } else {
        expect(result.status).toBe("intervention");
        expect(s.facts.request.open).toBe(true);
        if (scenario === "wrong text") {
          expect(output.checks[1].observed).toBe("Wrong catalogue");
        } else if (scenario === "page redirects") {
          expect(output.error).toContain("redirected");
        } else {
          expect(output.error).toContain("dirty build");
        }
      }
    } finally {
      s.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
