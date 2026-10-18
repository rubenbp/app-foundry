import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { OpenCode } from "@opencode/client";
import { Observer } from "../src/infrastructure/opencode/observer.ts";
import type { Fact } from "../src/application/agent.ts";

test("SDK observer preserves streamed transitions and reconciles messages and pending requests", async () => {
  const server = createServer((req, res) => {
    const path = req.url!.split("?")[0];
    if (path === "/api/event") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const status of ["busy", "idle"])
        res.write(
          `data: ${JSON.stringify({ type: "session.status", data: { sessionID: "s1", status: { type: status } } })}\n\n`,
        );
      return;
    }
    res.setHeader("Content-Type", "application/json");
    const responses: Record<string, unknown> = {
      "/api/session/active": { data: {} },
      "/api/session/s1/message": {
        data: [
          {
            id: "m1",
            type: "assistant",
            time: { created: 10, completed: 20 },
            finish: "stop",
            model: { providerID: "openai", id: "gpt-6-luna" },
            cost: 0,
            tokens: {
              input: 1,
              output: 2,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            content: [{ id: "p1", type: "text", text: "Result" }],
          },
        ],
        cursor: {},
      },
      "/api/permission/request": {
        data: [
          {
            id: "perm1",
            sessionID: "s1",
            action: "edit",
            resources: ["probe.txt"],
            metadata: { secret: "never expose metadata" },
          },
        ],
      },
      "/api/form": {
        data: [
          {
            id: "q1",
            sessionID: "s1",
            title: "Which file?",
            fields: [{ key: "file", type: "string", title: "File" }],
          },
        ],
      },
    };
    res.end(JSON.stringify(responses[path] ?? []));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const facts: Fact[] = [];
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${address.port}` });
  const observer = new Observer(client, "s1", (fact) => facts.push(fact));
  try {
    await observer.start();
    await observer.poll();
    assert.ok(facts.some((f) => f.type === "status" && f.status === "busy"));
    assert.ok(facts.some((f) => f.type === "status" && f.status === "idle"));
    assert.ok(facts.some((f) => f.type === "part" && f.text === "Result"));
    assert.ok(
      facts.some((f) => f.type === "pending" && f.pending.length === 2),
    );
    assert.doesNotMatch(JSON.stringify(facts), /never expose metadata/);
  } finally {
    observer.close();
    server.closeAllConnections();
    server.close();
  }
});

test("SDK reconciliation reaches messages beyond page 200 and refreshes existing messages", async () => {
  let updated = false;
  const cursors: (string | null)[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/api/session/s1/message") {
      const cursor = url.searchParams.get("cursor");
      cursors.push(cursor);
      if (cursor && url.searchParams.has("order")) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            name: "InvalidCursorError",
            data: { message: "Cursor cannot be combined with order" },
          }),
        );
        return;
      }
      const message = (id: string, text: string, finished = false) => ({
        id,
        type: "assistant",
        model: { providerID: "openai", id: "gpt-6-luna" },
        time: { created: 10, ...(finished ? { completed: 20 } : {}) },
        ...(finished ? { finish: "stop" } : {}),
        content: [{ type: "text", text }],
      });
      res.end(
        JSON.stringify(
          cursor === null
            ? {
                data: Array.from({ length: 200 }, (_, i) =>
                  message(
                    `m${i}`,
                    i === 0 && updated
                      ? "Growing text updated"
                      : "Initial text",
                  ),
                ),
                cursor: { next: "page-2" },
              }
            : cursor === "page-2"
              ? {
                  data: [message("m200", "Final result", true)],
                  cursor: { next: "end" },
                }
              : { data: [], cursor: {} },
        ),
      );
    } else
      res.end(
        JSON.stringify(
          url.pathname === "/api/session/active" ? { data: {} } : { data: [] },
        ),
      );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const facts: Fact[] = [];
  const observer = new Observer(
    OpenCode.make({ baseUrl: `http://127.0.0.1:${address.port}` }),
    "s1",
    (fact) => facts.push(fact),
  );
  try {
    await observer.poll();
    updated = true;
    await observer.poll();
    assert.ok(
      facts.some(
        (f) =>
          f.type === "part" &&
          f.messageId === "m200" &&
          f.text === "Final result",
      ),
    );
    assert.ok(
      facts.some((f) => f.type === "finished" && f.text === "Final result"),
    );
    assert.ok(
      facts.some(
        (f) =>
          f.type === "part" &&
          f.messageId === "m0" &&
          f.text === "Growing text updated",
      ),
    );
    assert.deepEqual(cursors, [null, "page-2", "end", null, "page-2", "end"]);
    assert.equal(facts.filter((f) => f.type === "gap").length, 0);
  } finally {
    observer.close();
    server.closeAllConnections();
    server.close();
  }
});
