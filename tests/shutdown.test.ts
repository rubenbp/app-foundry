import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { verificationFixture } from "./support/verification.ts";
import { publicationFixture } from "./support/publication.ts";
import { recoveryConversation } from "./support/recovery.ts";

for (const failed of [true, false]) {
  test(`apagar ${failed ? "tras agotar la cuota" : "durante un Intento"} conserva el trabajo y exige Reintentar tras arrancar`, async () => {
    const conversation = recoveryConversation();
    const s = verificationFixture({ issueConversation: conversation.port });
    try {
      const run = await s.start();
      s.commit(
        "catalogue.txt",
        "Pending catalogue",
        "Preserve accumulated work",
      );
      const head = s.git("rev-parse", "HEAD");
      if (failed) {
        s.emit({ type: "error", text: "ChatGPT usage limit reached" });
        await s.workflow.poll();
      }
      await s.workflow.shutdown();
      assert.equal(s.workflow.view(run.id)?.status, "intervention");
      assert.equal(s.workflow.factory.active, run.id);
      assert.equal(s.workflow.view(run.id)?.process?.exited, true);
      s.reopen();
      await s.workflow.poll();
      assert.equal(
        s.tasks.length,
        1,
        "Restart must not send work automatically",
      );
      assert.equal(s.workflow.factory.active, run.id);
      assert.equal(
        s.workflow.view(run.id)?.workspace?.branch,
        run.workspace?.branch,
      );
      assert.equal(s.git("rev-parse", "HEAD"), head);
      const retry = conversation.add("reintentar");
      await s.workflow.poll();
      await s.workflow.poll();
      const current = s.workflow.view(run.id)!;
      assert.equal(current.status, "running", current.error ?? "");
      assert.equal(current.attempt, 2);
      assert.equal(current.endedAt, null);
      assert.deepEqual(current.recovery?.consumed, [retry.id]);
      assert.equal(s.tasks.length, 2);
      assert.equal(s.tasks[1].sessionId, run.sessionId);
      assert.deepEqual(s.resumed, [run.sessionId]);
      assert.equal(s.sessions, 1);
    } finally {
      s.close();
    }
  });
}

test("una parada incierta al apagar conserva la intervención y la reserva", async () => {
  const s = verificationFixture({ stopConfirmed: false });
  try {
    const run = await s.start();
    await s.workflow.shutdown();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.equal(s.workflow.view(run.id)?.process?.exited, false);
    assert.equal(s.workflow.factory.active, run.id);
    s.reopen();
    assert.equal(s.workflow.factory.active, run.id);
    assert.equal(s.tasks.length, 1);
  } finally {
    s.close();
  }
});

test("apagar durante revisión revoca el control y conserva la Ejecución para Reintentar", async () => {
  const conversation = recoveryConversation();
  const s = publicationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    await s.workflow.poll();
    assert.equal(s.facts.status?.state, "success");
    await s.workflow.shutdown();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.equal(s.facts.status?.state, "failure");
    s.reopen();
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.notEqual(s.facts.status?.state, "success");
    conversation.add("Reintentar");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "awaiting_review");
    assert.equal(s.facts.status?.state, "success");
    assert.equal(s.tasks.length, 1);
  } finally {
    s.close();
  }
});

test("stop explícito permanece terminal después de apagar y arrancar", async () => {
  const conversation = recoveryConversation();
  const s = verificationFixture({ issueConversation: conversation.port });
  try {
    const run = await s.start();
    await s.workflow.stop(run.id);
    await s.workflow.shutdown();
    s.reopen();
    conversation.add("Reintentar");
    await s.workflow.poll();
    assert.equal(s.workflow.view(run.id)?.status, "stopped");
    assert.equal(s.workflow.factory.active, null);
    assert.equal(s.tasks.length, 1);
  } finally {
    s.close();
  }
});

test("apagar interrumpe el comando de verificación antes de conservar la Ejecución", async () => {
  const s = verificationFixture({
    commands: ["node wait.mjs"],
    files: {
      ".gitignore": "verification.pid\n",
      "wait.mjs":
        "import {existsSync,writeFileSync} from 'node:fs'; if(existsSync('wait.flag')) {writeFileSync('verification.pid',String(process.pid));setInterval(()=>{},1000)} else console.log('base verified');",
    },
  });
  try {
    const run = await s.start();
    s.commit("wait.flag", "wait", "Long candidate check");
    s.finish();
    const verification = s.workflow.verifyCandidate();
    const path = join(s.directory, "verification.pid");
    for (let count = 0; count < 200 && !existsSync(path); count++) {
      await delay(10);
    }
    assert.ok(existsSync(path), "Candidate command started");
    const pid = Number(readFileSync(path, "utf8"));
    await s.workflow.shutdown();
    await verification;
    assert.throws(() => process.kill(pid, 0));
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.equal(s.workflow.factory.active, run.id);
    assert.notEqual(s.workflow.view(run.id)?.verification?.status, "passed");
    s.reopen();
    assert.equal(s.workflow.factory.active, run.id);
    assert.equal(s.tasks.length, 1);
  } finally {
    s.close();
  }
});

test("un fallo remoto al apagar no impide detener el agente ni conserva un éxito aparente", async () => {
  const s = publicationFixture();
  try {
    const run = await s.candidate();
    await s.workflow.poll();
    s.observationFails(true);
    await s.workflow.shutdown();
    assert.equal(s.workflow.view(run.id)?.status, "intervention");
    assert.equal(s.workflow.view(run.id)?.process?.exited, true);
    assert.equal(s.workflow.factory.active, run.id);
    assert.match(
      s.workflow.view(run.id)?.error ?? "",
      /No se confirmó la revocación/,
    );
  } finally {
    s.close();
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(
    `la CLI conserva una intervención y su reserva al recibir ${signal}`,
    { timeout: 15_000 },
    async () => {
      const conversation = recoveryConversation();
      const s = verificationFixture({ issueConversation: conversation.port });
      const bin = join(s.root, "bin");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "gh"),
        `#!${process.execPath}\nprocess.stdout.write("[[]]");\n`,
        { mode: 0o700 },
      );
      const projectPath = join(s.root, "project.json");
      const configPath = join(s.root, "factory.json");
      writeFileSync(projectPath, JSON.stringify(s.project));
      writeFileSync(
        configPath,
        JSON.stringify({
          ...s.config,
          managedProjectFile: projectPath,
          opencodeCli: "/nonexistent/opencode-test",
        }),
      );
      const run = await s.start();
      s.emit({ type: "error", text: "ChatGPT usage limit reached" });
      await s.workflow.poll();
      const current = s.workflow.view(run.id)!;
      current.process!.exited = true;
      s.workflow.factory.persist(current);
      s.close();
      const child = spawn(
        process.execPath,
        [resolve("src/cli.ts"), "serve", "--config", configPath, "--port", "0"],
        {
          env: {
            PATH: `${bin}:${process.env.PATH}`,
            HOME: s.root,
            TMPDIR: tmpdir(),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const exited = once(child, "exit");
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      try {
        const origin = await new Promise<string>((resolve, reject) => {
          let output = "";
          child.stdout.on("data", (chunk) => {
            output += String(chunk);
            const match = output.match(
              /Factory dashboard: (http:\/\/127\.0\.0\.1:\d+)/,
            );
            if (match && output.includes("Factory PID")) {
              resolve(match[1]);
            }
          });
          child.once("error", reject);
          child.once("exit", () =>
            reject(new Error(`Factory exited before readiness: ${stderr}`)),
          );
        });
        assert.equal((await fetch(`${origin}/api/view`)).status, 200);
        child.kill(signal);
        assert.equal((await exited)[0], 0, stderr);
        const identity = createHash("sha256")
          .update(s.project.repository.toLowerCase())
          .digest("hex");
        const reservation = join(
          realpathSync("/tmp"),
          `app-foundry-repository-${identity}.reservation.json`,
        );
        assert.ok(
          existsSync(reservation),
          "Closing the Factory must retain the reservation",
        );
        assert.equal(
          JSON.parse(readFileSync(reservation, "utf8")).runId,
          run.id,
        );
        s.reopen();
        assert.equal(s.workflow.view(run.id)?.status, "intervention");
        assert.equal(s.workflow.factory.active, run.id);
        assert.equal(s.tasks.length, 1);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
        await exited;
        s.close();
      }
    },
  );
}
