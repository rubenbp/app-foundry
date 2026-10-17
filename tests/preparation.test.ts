import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createWorkflow } from "../src/workflow.ts";
import { GitWorkspace, execute } from "../src/infrastructure/workspace.ts";
import type { AgentPort } from "../src/types.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "foundry-prepare-"));
  const source = join(root, "source");
  mkdirSync(source);
  const git = (...args: string[]) => {
    const result = spawnSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", ...args],
      { cwd: source, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-b", "develop");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(
    join(source, "README.md"),
    "Keep the whole catalogue accessible.\n",
  );
  writeFileSync(
    join(source, "check.js"),
    "console.log('catalogue base verified')",
  );
  git("add", ".");
  git("commit", "-m", "Working base");
  const baseSha = git("rev-parse", "HEAD");
  const project = {
    id: "alternative",
    repository: `team/alternative-${root.split("-").at(-1)}`,
    baseBranch: "develop",
    instructions: ["README.md"],
    preparation: {
      command: "node -e \"console.log('alternative preparation')\"",
    },
    verification: { commands: ["node check.js"] },
    publication: {
      provider: "vercel" as const,
      projectId: "different-project",
      productionOrigin: "https://different.example",
      humanMergeRequired: true as const,
    },
  };
  let startedIn = "";
  const tasks: string[] = [];
  const agent: AgentPort = {
    async start() {
      return { pid: 123, version: "test", configuration: {} };
    },
    async create() {
      return "s1";
    },
    async send(_id, task) {
      tasks.push(task);
    },
    async stop() {
      return { exited: true, detail: "Owned process absent" };
    },
  };
  const config = {
    dataDir: join(root, "data"),
    projectDir: source,
    provider: "openai",
    model: "gpt-6-luna",
    auth: "opencode" as const,
    managedProject: project,
  };
  const workspace = new GitWorkspace(
    config.dataDir,
    async (command, args, options) => {
      if (command === "git" && args.includes("clone")) {
        const changed = args.map((a) =>
          a === `https://github.com/${project.repository}.git` ? source : a,
        );
        const result = await execute(command, changed, options);
        await execute(
          "git",
          [
            "remote",
            "set-url",
            "origin",
            `https://github.com/${project.repository}.git`,
          ],
          { ...options, cwd: args.at(-1)! },
        );
        return result;
      }
      return execute(command, args, options);
    },
  );
  const workflow = createWorkflow(config, {
    workspace,
    createAgent: (config) => {
      startedIn = config.projectDir;
      return agent;
    },
  });
  const issue = {
    repository: project.repository,
    number: 17,
    title: "Accessible catalogue",
    body:
      "## Acceptance criteria\n" +
      "Keep every criterion verbatim.\n".repeat(3000),
    author: "product-owner",
    url: `https://github.com/${project.repository}/issues/17`,
    updatedAt: "2026-10-17T10:00:00Z",
    authorization: {
      id: "event17",
      actor: "writer",
      at: "2026-10-17T10:00:00Z",
      canWrite: true,
      contentUnchanged: true,
    },
  };

  return {
    root,
    source,
    baseSha,
    workflow,
    issue,
    tasks,
    startedIn: () => startedIn,
    project,
  };
}

test("an authorized request verifies its base in an owned branch before delivering every criterion", async () => {
  const s = fixture();
  try {
    await s.workflow.observe([s.issue]);
    const run = await s.workflow.startNext();
    assert.equal(run?.status, "running");
    assert.equal(run.workspace?.baseSha, s.baseSha);
    assert.notEqual(s.startedIn(), s.source);
    assert.equal(
      readFileSync(join(s.startedIn(), "README.md"), "utf8"),
      "Keep the whole catalogue accessible.\n",
    );
    assert.ok(s.tasks[0].includes(s.issue.body));
    assert.ok(s.tasks[0].includes("different-project"));
    assert.ok(s.tasks[0].includes("Keep the whole catalogue accessible."));
    assert.equal(run.request?.body.length, s.issue.body.length);
    assert.match(
      s.workflow.factory.output(run.id, "base-1")!,
      /catalogue base verified/,
    );
    await s.workflow.observe([
      {
        ...s.issue,
        number: 18,
        url: `https://github.com/${s.project.repository}/issues/18`,
      },
    ]);
    assert.equal(await s.workflow.startNext(), null);
    assert.equal(s.workflow.queue().length, 1);
  } finally {
    s.workflow.close();
  }
});

test("a pre-existing base failure requires intervention and never attributes a regression to an agent", async () => {
  const s = fixture();
  s.project.verification.commands = [
    "node -e \"console.log('broken base');process.exit(3)\"",
  ];
  try {
    await s.workflow.observe([s.issue]);
    const run = await s.workflow.startNext();
    assert.equal(run?.status, "intervention");
    assert.equal(run.phase, "preparation");
    assert.match(run.error!, /Pre-existing base failed/);
    assert.equal(run.sessionId, null);
    assert.equal(s.tasks.length, 0);
    assert.match(s.workflow.factory.output(run.id, "base-1")!, /broken base/);
    assert.equal(await s.workflow.startNext(), null);
  } finally {
    s.workflow.close();
  }
});

test("preparation cannot hand an altered branch to the agent", async () => {
  const s = fixture();
  s.project.preparation.command = "git checkout -b unexpected";
  try {
    await s.workflow.observe([s.issue]);
    const run = await s.workflow.startNext();
    assert.equal(run?.status, "intervention");
    assert.match(run.error!, /branch or hook policy changed/);
    assert.equal(s.tasks.length, 0);
  } finally {
    s.workflow.close();
  }
});
