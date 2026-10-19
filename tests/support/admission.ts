import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReadyIssue, ManagedProject } from "../../src/domain/request.ts";
import type { AgentPort } from "../../src/application/agent.ts";

export const project: ManagedProject = {
  id: "other-product",
  repository: "team/other-product",
  baseBranch: "develop",
  instructions: ["README.md"],
  preparation: { command: "npm ci" },
  verification: { commands: ["npm run check", "npm test"] },
  publication: {
    provider: "vercel",
    projectId: "other-id",
    humanMergeRequired: true,
  },
};
export function ready(number = 1): ReadyIssue {
  return {
    repository: project.repository,
    number,
    title: "Show the catalogue",
    body: "## Acceptance criteria\n- Show every game.\n- Keep keyboard navigation.",
    author: "requester",
    url: `https://github.com/${project.repository}/issues/${number}`,
  };
}
export function setup() {
  const root = mkdtempSync(join(tmpdir(), "foundry-admission-"));
  const tasks: string[] = [];
  const agent: AgentPort = {
    async start() {
      return { pid: 123, version: "test", configuration: {} };
    },
    async resume() {},
    async create() {
      return "session";
    },
    async send(_id, task) {
      tasks.push(task);
    },
    async stop() {
      return { exited: true, detail: "No owned process remains" };
    },
  };
  const config = {
    dataDir: join(root, "data"),
    projectDir: join(root, "probe"),
    provider: "openai",
    model: "gpt-6-luna",
    auth: "opencode" as const,
    managedProject: {
      ...project,
      repository: `team/admission-${root.split("-").at(-1)}`,
    },
  };

  return {
    root,
    config,
    agent,
    tasks,
    ready(number = 1): ReadyIssue {
      return {
        ...ready(number),
        repository: config.managedProject.repository,
        url: `https://github.com/${config.managedProject.repository}/issues/${number}`,
      };
    },
  };
}
