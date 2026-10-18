import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkflow } from "../../src/composition/workflow.ts";
import { GitWorkspace } from "../../src/infrastructure/workspace.ts";
import { execute } from "../../src/infrastructure/process.ts";
import type { ProcessPort } from "../../src/infrastructure/process.ts";
import type { Fact, AgentPort } from "../../src/application/agent.ts";
import type { ManagedProject } from "../../src/domain/request.ts";
import type {
  PublicationPort,
  ProductionPort,
} from "../../src/application/publication/ports.ts";

export function verificationFixture(
  options: {
    stopConfirmed?: boolean;
    process?: ProcessPort;
    files?: Record<string, string>;
    commands?: string[];
    e2e?: ManagedProject["verification"]["e2e"];
    publication?: PublicationPort;
    production?: ProductionPort;
    body?: string;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "foundry-verify-"));
  const source = join(root, "source");
  mkdirSync(source);
  let directory = source;
  const git = (...args: string[]) => {
    const result = spawnSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", ...args],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Test",
          GIT_AUTHOR_EMAIL: "test@example.com",
          GIT_COMMITTER_NAME: "Test",
          GIT_COMMITTER_EMAIL: "test@example.com",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-b", "main");
  writeFileSync(join(source, "README.md"), "Keep keyboard navigation.");
  writeFileSync(join(source, "catalogue.txt"), "Working catalogue");
  writeFileSync(
    join(source, "check.mjs"),
    "import { readFileSync } from 'node:fs'; if (readFileSync('catalogue.txt', 'utf8').includes('defect')) {console.log('earlier defect');process.exit(7)} console.log('catalogue checked');",
  );
  for (const [path, text] of Object.entries(options.files ?? {})) {
    mkdirSync(join(source, path, ".."), { recursive: true });
    writeFileSync(join(source, path), text);
  }
  git("add", ".");
  git("commit", "-m", "Working base");
  const baseSha = git("rev-parse", "HEAD");
  const project: ManagedProject = {
    id: "catalogue",
    repository: `team/verify-${root.split("-").at(-1)}`,
    baseBranch: "main",
    instructions: ["README.md"],
    preparation: { command: "node --version" },
    verification: {
      commands: options.commands ?? ["node check.mjs"],
      ...(options.e2e ? { e2e: options.e2e } : {}),
    },
    publication: {
      provider: "vercel",
      projectId: "catalogue",
      productionOrigin: "https://catalogue.example",
      humanMergeRequired: true,
    },
  };
  const config = {
    dataDir: join(root, "data"),
    projectDir: source,
    provider: "openai",
    model: "test",
    auth: "opencode" as const,
    managedProject: project,
  };
  let emit: (fact: Fact) => void = () => {};
  let onStop = () => {};
  const agent: AgentPort = {
    async start(sink) {
      emit = sink;
      return { pid: 123, version: "test", configuration: {} };
    },
    async create() {
      return "session";
    },
    async send() {},
    async stop() {
      onStop();
      return {
        exited: options.stopConfirmed !== false,
        detail: "Agent stop checked",
      };
    },
  };
  const processPort: ProcessPort = async (command, args, settings) => {
    if (command === "git" && args.includes("clone")) {
      const result = await execute(
        command,
        args.map((a) =>
          a === `https://github.com/${project.repository}.git` ? source : a,
        ),
        settings,
      );
      await execute(
        "git",
        [
          "remote",
          "set-url",
          "origin",
          `https://github.com/${project.repository}.git`,
        ],
        { ...settings, cwd: args.at(-1)! },
      );
      return result;
    }
    return options.process
      ? options.process(command, args, settings)
      : execute(command, args, settings);
  };
  const makeWorkflow = () =>
    createWorkflow(config, {
      createAgent: () => agent,
      workspace: new GitWorkspace(config.dataDir, processPort),
      verificationProcess: processPort,
      publication: options.publication,
      production: options.production,
      github: {
        async ready() {
          return [];
        },
      },
    });
  let workflow = makeWorkflow();

  return {
    root,
    config,
    project,
    baseSha,
    git,
    get directory() {
      return directory;
    },
    get workflow() {
      return workflow;
    },
    async start() {
      await workflow.observe([
        {
          repository: project.repository,
          number: 1,
          title: "Accessible catalogue",
          body:
            options.body ??
            "## Acceptance criteria\n- Keep keyboard navigation.\n- Show the catalogue.",
          author: "owner",
          url: `https://github.com/${project.repository}/issues/1`,
          updatedAt: "2026-10-17T10:00:00Z",
          authorization: {
            id: "ready1",
            actor: "writer",
            at: "2026-10-17T10:00:00Z",
            canWrite: true,
            contentUnchanged: true,
          },
        },
      ]);
      const run = (await workflow.startNext())!;
      assert.equal(run.status, "running", run.error ?? "");
      directory = run.workspace!.directory;
      return run;
    },
    commit(path: string, text: string, message: string) {
      writeFileSync(join(directory, path), text);
      git("add", "--", path);
      git("commit", "-m", message);
    },
    finish() {
      emit({ type: "finished", text: "Agent claims success" });
    },
    onStop(action: () => void) {
      onStop = action;
    },
    reopen() {
      workflow.close();
      workflow = makeWorkflow();
    },
    close() {
      workflow.close();
    },
  };
}
