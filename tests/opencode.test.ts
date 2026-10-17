import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { OpenCode } from "@opencode/client";
import { Observer } from "../src/opencode.ts";
import type { Fact } from "../src/types.ts";

test("SDK observer preserves streamed transitions and reconciles messages and pending requests", async () => {
  const server = createServer((req, res) => {
    const path = req.url!.split("?")[0];
    if (path === "/api/event") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const status of ["busy", "idle"]) res.write(`data: ${JSON.stringify({ type: "session.status", data: { sessionID: "s1", status: { type: status } } })}\n\n`);
      return;
    }
    res.setHeader("Content-Type", "application/json");
    const responses: Record<string, unknown> = {
      "/api/session/active": { data: {} },
      "/api/session/s1/message": { data: [{ id: "m1", type: "assistant", time: { created: 10, completed: 20 }, finish: "stop", model: { providerID: "openai", id: "gpt-6-luna" }, cost: 0, tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } }, content: [{ id: "p1", type: "text", text: "Result" }] }], cursor: {} },
      "/api/permission/request": { data: [{ id: "perm1", sessionID: "s1", action: "edit", resources: ["probe.txt"], metadata: { secret: "never expose metadata" } }] },
      "/api/form": { data: [{ id: "q1", sessionID: "s1", title: "Which file?", fields: [{ key: "file", type: "string", title: "File" }] }] },
    };
    res.end(JSON.stringify(responses[path] ?? []));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const facts: Fact[] = [];
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${address.port}` });
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
