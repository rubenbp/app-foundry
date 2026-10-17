import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { ManagedProject, Workspace } from "../domain/request.ts";
import type { Effect, WorkspacePort } from "../application/ports.ts";

export interface ProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}
export interface CommandResult {
  code: number;
  output: string;
}
export type ProcessPort = (
  command: string,
  args: string[],
  options: ProcessOptions,
) => Promise<CommandResult>;

export const execute: ProcessPort = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let truncated = false;
    const collect = (chunk: Buffer) => {
      if (output.length < 1_000_000) output += String(chunk);
      else truncated = true;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({
        code: code ?? -1,
        output: output + (truncated ? "\n[TRUNCATED]" : ""),
      }),
    );
  });

// This reduces accidental access. Processes under the same macOS user are not an OS sandbox.
export function reducedEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    LANG: "en_US.UTF-8",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "",
    GIT_AUTHOR_NAME: "App Foundry",
    GIT_AUTHOR_EMAIL: "factory@localhost",
    GIT_COMMITTER_NAME: "App Foundry",
    GIT_COMMITTER_EMAIL: "factory@localhost",
  };
}

export class GitWorkspace implements WorkspacePort {
  private root: string;
  private process: ProcessPort;
  constructor(dataDir: string, processPort: ProcessPort = execute) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.root = realpathSync(dataDir);
    this.process = processPort;
  }
  private options(directory: string): ProcessOptions {
    const home = join(this.root, "command-home");
    mkdirSync(home, { recursive: true, mode: 0o700 });
    return { cwd: directory, env: reducedEnvironment(home) };
  }
  private async git(directory: string, args: string[]) {
    const result = await this.process(
      "git",
      ["-c", "core.hooksPath=/dev/null", ...args],
      this.options(directory),
    );
    if (result.code !== 0)
      throw new Error(`Git inspection failed: ${result.output}`);
    return result.output.trim();
  }
  async validate(workspace: Workspace, project: ManagedProject) {
    const expected = join(this.root, "workspaces");
    const path = realpathSync(workspace.directory);
    if (!path.startsWith(expected + sep) || path !== workspace.directory)
      throw new Error("Workspace path escaped the owned clone root");
    if (
      (await this.git(path, ["rev-parse", "--show-toplevel"])) !== path ||
      (await this.git(path, ["remote", "get-url", "origin"])) !==
        `https://github.com/${project.repository}.git` ||
      (await this.git(path, ["branch", "--show-current"])) !==
        workspace.branch ||
      (await this.git(path, ["config", "--get", "core.hooksPath"])) !==
        "/dev/null"
    )
      throw new Error(
        "Owned path, repository, remote, branch or hook policy changed",
      );
    const push = await this.git(path, [
      "remote",
      "get-url",
      "--push",
      "origin",
    ]);
    if (push !== "disabled://factory-owned-remote-effects")
      throw new Error("Agent push remote must remain disabled");
  }
  async prepare(
    id: string,
    project: ManagedProject,
    effect: Effect,
  ): Promise<Workspace> {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new Error("Invalid Ejecución identity");
    const clones = join(this.root, "workspaces");
    mkdirSync(clones, { recursive: true, mode: 0o700 });
    const directory = join(clones, id);
    const branch = `codex/execution-${id}`;
    await effect("clone", "Create owned clone and branch", async () => {
      if (existsSync(directory))
        throw new Error(
          "Clone already exists; inspect uncertain preparation before reuse",
        );
      // Only clone transport can use the trusted user's GitHub credentials. Candidate commands cannot.
      const env = {
        ...this.options(clones).env,
        HOME: process.env.HOME,
        GH_TOKEN: process.env.GH_TOKEN,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        GIT_CONFIG_COUNT: "3",
        GIT_CONFIG_KEY_2: "credential.helper",
        GIT_CONFIG_VALUE_2: "!gh auth git-credential",
      };
      const result = await this.process(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "clone",
          "--no-checkout",
          "--single-branch",
          "--branch",
          project.baseBranch,
          "--",
          `https://github.com/${project.repository}.git`,
          directory,
        ],
        { cwd: clones, env },
      );
      if (result.code !== 0) throw new Error(`Clone failed: ${result.output}`);
      await this.git(directory, ["config", "core.hooksPath", "/dev/null"]);
      await this.git(directory, [
        "config",
        "remote.origin.pushurl",
        "disabled://factory-owned-remote-effects",
      ]);
      await this.git(directory, [
        "checkout",
        "-b",
        branch,
        `origin/${project.baseBranch}`,
      ]);
      return { label: "Owned clone ready", output: result.output };
    });
    const { workspace } = await effect(
      "base-context",
      "Capture base identity and complete instructions",
      async () => {
        const baseSha = await this.git(directory, ["rev-parse", "HEAD"]);
        const workspace: Workspace = {
          directory,
          branch,
          baseSha,
          instructions: [],
        };
        await this.validate(workspace, project);
        for (const path of project.instructions) {
          const target = realpathSync(resolve(directory, path));
          if (isAbsolute(path) || !target.startsWith(directory + sep))
            throw new Error("Instruction path escaped clone");
          workspace.instructions.push({
            path,
            text: readFileSync(target, "utf8"),
          });
        }
        return {
          workspace,
          label: "Base identity captured",
          output: `Base ${baseSha}\nBranch ${branch}\nRepository ${project.repository}`,
        };
      },
    );
    const { baseSha } = workspace;
    for (const [index, command] of [
      project.preparation.command,
      ...project.verification.commands,
    ].entries()) {
      await effect(
        index === 0 ? "preparation" : `base-${index}`,
        index === 0
          ? `Prepare base: ${command}`
          : `Check pre-existing base: ${command}`,
        async () => {
          await this.validate(workspace, project);
          const result = await this.process(
            "/bin/sh",
            ["-c", command],
            this.options(directory),
          );

          return {
            label: `${command} · exit ${result.code}`,
            output: `Base ${baseSha}\nCommand: ${command}\nExit: ${result.code}\n${result.output}`,
            code: result.code,
          };
        },
      ).then((result) => {
        if (result.code !== 0)
          throw new Error(
            `Pre-existing base failed: ${command} (exit ${result.code}); agent has not started`,
          );
      });
    }
    await this.validate(workspace, project);
    if ((await this.git(directory, ["rev-parse", "HEAD"])) !== baseSha)
      throw new Error("Base command changed the committed base");
    await this.git(directory, ["diff", "--exit-code", "HEAD", "--"]);
    return workspace;
  }
}
