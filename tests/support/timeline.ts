import type { Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { createFactory } from "../../src/composition/factory.ts";
import { panelServer } from "../../src/infrastructure/http/panelServer.ts";
import type { AgentPort, Fact } from "../../src/application/agent.ts";

export async function timelineFixture(
  page: Page,
  options: { stop?: AgentPort["stop"] } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "foundry-timeline-"));
  let emit: (fact: Fact) => void = () => {};
  let now = 1_800_000_000_000;
  const factory = createFactory(
    {
      dataDir: root,
      projectDir: join(root, "project"),
      provider: "google",
      model: "gemini-2.5-flash",
      auth: "opencode",
    },
    {
      async start(sink) {
        emit = sink;
        return { pid: 123, version: "test", configuration: {} };
      },
      async resume() {},
      async create() {
        return "s1";
      },
      async send() {},
      async stop(sessionId) {
        if (options.stop) {
          return options.stop(sessionId);
        }
        return { exited: true, detail: "Owned process stopped" };
      },
    },
    { now: () => now, secrets: ["fictional-secret-123"] },
  );
  const run = await factory.run("Relacionar actividad y evidencia");
  const part = (id: string, text: string, kind = "text", label = id) => {
    now += 1000;
    emit({ type: "part", id, messageId: "message", kind, label, text });
  };
  let persistenceClosed = false;
  const server = panelServer(factory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  return {
    factory,
    run,
    part,
    emit,
    origin,
    advance(milliseconds = 1000) {
      now += milliseconds;
    },
    async open() {
      await page.goto(origin);
    },
    closePersistence() {
      if (!persistenceClosed) {
        factory.close();
      }
      persistenceClosed = true;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (!persistenceClosed) {
        factory.close();
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}
