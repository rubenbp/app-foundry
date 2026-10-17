import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";

test("CLI rejects a second instance, preserves uncertain work after restart, and never resubmits it", async () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-cli-"));
  const project = join(root, "project");
  mkdirSync(project);
  const config = join(root, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      dataDir: join(root, "data"),
      projectDir: project,
      provider: "openai",
      model: "gpt-6-luna",
      auth: "opencode",
      opencodeCli: "/nonexistent/opencode-auth-test",
    }),
  );
  const env = { PATH: process.env.PATH, HOME: root, TMPDIR: tmpdir() };
  const launch = (...args: string[]) =>
    spawn(
      process.execPath,
      [resolve("src/cli.ts"), ...args, "--config", config],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
  const ready = (child: ChildProcess) =>
    new Promise<string>((resolve, reject) => {
      let output = "";
      child.stdout!.on("data", (chunk) => {
        output += String(chunk);
        const match = output.match(
          /Factory panel: (http:\/\/127\.0\.0\.1:\d+)/,
        );
        if (match) resolve(match[1]);
      });
      child.once("exit", () =>
        reject(new Error("Factory exited before readiness")),
      );
      child.once("error", reject);
    });
  let child = launch("serve", "--port", "0");
  try {
    const origin = await ready(child);
    const second = launch("serve", "--port", "0");
    assert.notEqual((await once(second, "exit"))[0], 0);
    const task = join(root, "task.txt");
    writeFileSync(task, "Never sent: no credential in the test environment");
    const admission = launch("run", "--task-file", task);
    await once(admission, "exit");
    const snapshot = await fetch(`${origin}/api/view`).then((r) => r.json());
    assert.equal(snapshot.run.status, "intervention");
    assert.match(snapshot.run.error, /OAuth export unavailable/);
    const id = snapshot.run.id;
    const exit = once(child, "exit");
    child.kill("SIGTERM");
    await exit;
    child = launch("serve", "--port", "0");
    const restarted = await ready(child);
    const recovered = await fetch(`${restarted}/api/view`).then((r) =>
      r.json(),
    );
    assert.equal(recovered.run.id, id);
    assert.match(recovered.run.error, /no task was resent/);
    assert.equal(recovered.runs.length, 1);
  } finally {
    const exit = once(child, "exit");
    child.kill("SIGTERM");
    await exit;
  }
});
