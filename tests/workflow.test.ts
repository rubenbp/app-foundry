import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Factory } from "../src/factory.ts";
import type { AgentPort, Fact } from "../src/types.ts";
import { consumption } from "../src/types.ts";
import { DatabaseSync } from "node:sqlite";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "foundry-test-"));
  let sink: (fact: Fact) => void = () => {};
  let sends = 0;
  let stops = 0;
  const agent: AgentPort = {
    async start(emit) {
      sink = emit;
      return {
        pid: 123,
        version: "1.19.3",
        configuration: { model: "google/gemini-2.5-flash" },
      };
    },
    async create() {
      return "session-1";
    },
    async send() {
      sends++;
    },
    async stop() {
      stops++;
      return {
        exited: true,
        detail: "Owned process exited; remote effects unknown",
      };
    },
  };
  const config = {
    dataDir: root,
    projectDir: root + "/project",
    provider: "google",
    model: "gemini-2.5-flash",
    auth: "opencode" as const,
  };
  const factory = new Factory(config, agent, {
    secrets: ["fictional-secret-123"],
    now: () => 1000,
  });

  return {
    root,
    config,
    agent,
    factory,
    emit: (fact: Fact) => sink(fact),
    sends: () => sends,
    stops: () => stops,
  };
}

test("an Intento retains brief transitions and growing messages, without crediting idle as success", async () => {
  const s = setup();
  const run = await s.factory.run("Read package.json");
  s.emit({ type: "status", status: "busy" });
  s.emit({
    type: "part",
    id: "p1",
    messageId: "m1",
    kind: "text",
    text: "Hello",
  });
  s.emit({
    type: "part",
    id: "p1",
    messageId: "m1",
    kind: "text",
    text: "Hello fictional-secret-123 <script>alert(1)</script>",
  });
  s.emit({ type: "status", status: "idle" });
  const view = s.factory.view(run.id)!;
  assert.equal(view.status, "running");
  assert.equal(view.parts.length, 1);
  assert.match(s.factory.output(run.id, "p1")!, /Hello \[REDACTED\]/);
  assert.deepEqual(
    view.history.filter((h) => h.kind === "opencode-status").map((h) => h.text),
    ["busy", "idle"],
  );
  assert.equal(view.result, null);
  s.factory.close();
});

test("a SQLite write failure prevents sending the task after server startup", async () => {
  const s = setup();
  const blocker = new DatabaseSync(join(s.root, "factory.sqlite"));
  s.agent.start = async () => {
    blocker.exec("BEGIN IMMEDIATE");
    return { pid: 123, version: "1.19.3", configuration: {} };
  };
  try {
    await assert.rejects(s.factory.run("Do not send on persistence failure"));
    assert.equal(s.sends(), 0);
    assert.match(s.factory.fault!, /Persistence failed/);
  } finally {
    blocker.exec("ROLLBACK");
    blocker.close();
    s.factory.close();
  }
});

test("stopping while session creation is in flight never sends the task", async () => {
  const s = setup();
  let release!: (session: string) => void;
  let creating!: () => void;
  const created = new Promise<void>((resolve) => {
    creating = resolve;
  });
  s.agent.create = () => {
    creating();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const pending = s.factory.run("Do not run after stop");
  await created;
  await s.factory.stop(s.factory.list()[0].id);
  release("s1");
  const run = await pending;
  assert.equal(run.status, "stopped");
  assert.equal(s.sends(), 0);
  s.factory.close();
});

test("late observations cannot revive a stopped Ejecución", async () => {
  const s = setup();
  const run = await s.factory.run("A bounded task");
  await s.factory.stop(run.id);
  s.emit({
    type: "pending",
    pending: [{ id: "late", kind: "permission", text: "late edit" }],
  });
  assert.equal(s.factory.view(run.id)!.status, "stopped");
  s.factory.close();
});

test("pending requests and completion cannot clear an intervention", async () => {
  for (const failure of [
    { type: "error", text: "Provider failure" },
    { type: "process-exit", detail: "Unexpected exit" },
  ] as const) {
    const s = setup();
    const run = await s.factory.run("A bounded task");
    s.emit(failure);
    s.emit({
      type: "pending",
      pending: [{ id: "p1", kind: "permission", text: "edit file" }],
    });
    assert.equal(s.factory.view(run.id)!.status, "intervention");
    assert.equal(s.factory.view(run.id)!.pending.length, 1);
    s.emit({ type: "pending", pending: [] });
    s.emit({ type: "finished", text: "Claimed completion" });
    assert.equal(s.factory.view(run.id)!.status, "intervention");
    assert.ok(s.factory.view(run.id)!.error);
    s.factory.close();
  }
});

test("permissions remain pending, stop is explicit, and restart preserves history without resending", async () => {
  const s = setup();
  const run = await s.factory.run("A bounded task");
  s.emit({
    type: "pending",
    pending: [{ id: "q1", kind: "permission", text: "edit probe.txt" }],
  });
  assert.equal(s.factory.view(run.id)!.status, "waiting");
  await assert.rejects(s.factory.run("Second task"), /already occupies/);
  s.factory.close();
  const resumed = new Factory(s.config, s.agent);
  assert.equal(resumed.view(run.id)!.status, "intervention");
  assert.equal(resumed.view(run.id)!.pending[0].id, "q1");
  assert.equal(s.sends(), 1);
  assert.match(resumed.view(run.id)!.error!, /no task was resent/);
  await resumed.stop(run.id);
  assert.equal(resumed.view(run.id)!.status, "stopped");
  assert.equal(s.stops(), 1);
  resumed.close();
});

test("SDK usage replaces each message and zero without valid basis stays unavailable", async () => {
  const s = setup();
  const run = await s.factory.run("Read a file");
  const usage = {
    id: "m1",
    provider: "google",
    model: "gemini-2.5-flash",
    tokens: { input: 10, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 0 },
    sdkCost: 0,
    completed: true,
  };
  s.emit({ type: "usage", usage });
  s.emit({ type: "usage", usage });
  assert.equal(consumption(s.factory.view(run.id)!.usage).observedTokens, 19);
  assert.equal(consumption(s.factory.view(run.id)!.usage).estimatedCost, null);
  s.emit({ type: "usage", usage: { ...usage, sdkCost: 0.002 } });
  assert.equal(consumption(s.factory.view(run.id)!.usage).estimatedCost, 0.002);
  assert.equal(
    consumption(s.factory.view(run.id)!.usage).accreditedSpend,
    null,
  );
  s.factory.close();
});

test("artifact persistence failure blocks new effects and no raw secret reaches disk", async () => {
  const s = setup();
  const run = await s.factory.run("fictional-secret-123");
  s.emit({
    type: "part",
    id: "p1",
    messageId: "m1",
    kind: "tool",
    text: "authorization: Bearer fictional-secret-123",
  });
  assert.doesNotMatch(
    readFileSync(join(s.root, "factory.sqlite")).toString(),
    /fictional-secret-123/,
  );
  for (const name of readdirSync(join(s.root, "artifacts")))
    assert.doesNotMatch(
      readFileSync(join(s.root, "artifacts", name), "utf8"),
      /fictional-secret-123/,
    );
  renameSync(join(s.root, "artifacts"), join(s.root, "old-artifacts"));
  writeFileSync(join(s.root, "artifacts"), "unwritable directory");
  assert.throws(() =>
    s.emit({
      type: "part",
      id: "p2",
      messageId: "m1",
      kind: "text",
      text: "hello",
    }),
  );
  await assert.rejects(s.factory.stop(run.id), /effects blocked/);
  assert.equal(s.stops(), 0);
  s.factory.close();
});
