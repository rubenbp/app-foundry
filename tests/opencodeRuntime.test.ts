import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "../src/infrastructure/opencode/agent.ts";

test(
  "OpenCode real conserva el thread al parar el servidor y recupera una conexión viva sin llamar al modelo",
  { timeout: 60_000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "foundry-conversation-"));
    const exporter = join(root, "auth-export");
    const credentials = [
      {
        active: true,
        integrationID: "openai",
        value: {
          type: "oauth",
          methodID: "oauth",
          access: "fictional-access",
          refresh: "fictional-refresh",
          expires: Date.now() + 3_600_000,
        },
      },
    ];
    writeFileSync(
      exporter,
      `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(credentials))});\n`,
      { mode: 0o700 },
    );
    const config = {
      dataDir: root,
      projectDir: root,
      provider: "openai",
      model: "gpt-6-luna",
      auth: "opencode" as const,
      opencodeCli: exporter,
      conversationId: "issue-1",
    };
    const first = new OpenCode(config);
    const restarted = new OpenCode(config);
    const attached = new OpenCode(config);
    let sessionId: string | null = null;
    try {
      await first.start(() => {});
      sessionId = await first.create();
      await first.client!.session.update({
        sessionID: sessionId,
        title: "Dudas de producto pendientes",
      });
      const original = await first.client!.session.export({
        sessionID: sessionId,
      });
      original.messages.push(
        {
          id: "msg_human_context",
          type: "user",
          time: { created: Date.now() },
          text: "Conserva la navegación con teclado.",
        },
        {
          id: "msg_pending_questions",
          type: "assistant",
          agent: "factory",
          model: { providerID: "openai", id: "gpt-6-luna" },
          time: { created: Date.now(), completed: Date.now() },
          finish: "stop",
          content: [
            {
              type: "text",
              text: "<factory-intervention>\n¿Qué título?\n¿Mostramos precios?\n</factory-intervention>",
            },
          ],
        },
      );
      // Prepara un historial conocido sin iniciar una ejecución del modelo.
      await first.client!.session.remove({ sessionID: sessionId });
      await first.client!.session.import(original);
      const stopped = await first.stop(sessionId);
      assert.ok(stopped.exited, stopped.detail);
      assert.ok(existsSync(join(root, "conversations", "issue-1", "data")));
      const process = await restarted.start(() => {});
      await restarted.resume(sessionId);
      const restored = await restarted.client!.session.export({
        sessionID: sessionId,
      });
      assert.equal(restored.info.id, original.info.id);
      assert.equal(restored.info.title, "Dudas de producto pendientes");
      assert.deepEqual(restored.messages, original.messages);
      const reused = await attached.start(() => {});
      assert.equal(reused.pid, process.pid);
      await attached.resume(sessionId);
      assert.equal(
        (await attached.client!.session.get({ sessionID: sessionId })).id,
        sessionId,
      );
    } finally {
      first.observer?.close();
      restarted.observer?.close();
      attached.observer?.close();
      for (const agent of [attached, restarted, first]) {
        if (agent.ownedPid) {
          await agent.stop(sessionId);
        }
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);
