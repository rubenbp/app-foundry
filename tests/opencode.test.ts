import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { Observer } from "../src/opencode.ts";
import type { Fact } from "../src/types.ts";

test("SDK observer preserves streamed transitions and reconciles messages and pending requests", async () => {
  const server = createServer((req, res) => {
    const path = req.url!.split("?")[0];
    if (path === "/event") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const status of ["busy", "idle"]) res.write(`data: ${JSON.stringify({ type: "session.status", properties: { sessionID: "s1", status: { type: status } } })}\n\n`);
      return;
    }
    res.setHeader("Content-Type", "application/json");
    const responses: Record<string, unknown> = {
      "/session/status": { s1: { type: "idle" } },
      "/session/s1/message": [{ info: { id: "m1", sessionID: "s1", role: "assistant", time: { created: 10, completed: 20 }, finish: "stop", providerID: "google", modelID: "gemini-2.5-flash", cost: 0, tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } } }, parts: [{ id: "p1", messageID: "m1", sessionID: "s1", type: "text", text: "Result" }] }],
      "/permission": [{ id: "perm1", sessionID: "s1", permission: "edit", patterns: ["probe.txt"], metadata: { secret: "never expose metadata" } }],
      "/question": [{ id: "q1", sessionID: "s1", questions: [{ header: "Choice", question: "Which file?", options: [] }] }],
    };
    res.end(JSON.stringify(responses[path] ?? []));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const facts: Fact[] = [];
  const client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${address.port}`, throwOnError: true });
  const observer = new Observer(client, "s1", fact => facts.push(fact));
  try {
    await observer.start();
    await observer.poll();
    assert.ok(facts.some(f => f.type === "status" && f.status === "busy"));
    assert.ok(facts.some(f => f.type === "status" && f.status === "idle"));
    assert.ok(facts.some(f => f.type === "part" && f.text === "Result"));
    assert.ok(facts.some(f => f.type === "pending" && f.pending.length === 2));
    assert.doesNotMatch(JSON.stringify(facts), /never expose metadata/);
  } finally { observer.close(); server.closeAllConnections(); server.close(); }
});
