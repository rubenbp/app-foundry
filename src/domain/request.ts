import { createHash } from "node:crypto";

export interface ManagedProject {
  id: string;
  repository: string;
  baseBranch: string;
  instructions: string[];
  preparation: { command: string };
  verification: {
    commands: string[];
    surfaces?: string[];
    e2e?: {
      command: string;
      configFile: string;
      serverCommand: string;
      origin: string;
      serves: string;
      reuseExistingServer: false;
      offline: boolean;
    };
  };
  publication: {
    provider: "vercel";
    projectId: string;
    productionOrigin: string;
    humanMergeRequired: true;
    previewEnvironment?: string;
    [key: string]: unknown;
  };
}
export interface ReadyIssue {
  repository: string;
  number: number;
  title: string;
  body: string;
  author: string;
  url: string;
  updatedAt: string;
  authorization: {
    id: string;
    actor: string;
    at: string;
    canWrite: boolean | null;
    contentUnchanged: boolean;
  };
}
export interface AgentConfiguration {
  provider: string;
  model: string;
  auth: "opencode";
  opencodeCli?: string;
}
export interface AuthorizedIssue extends ReadyIssue {
  capturedAt: number;
  contentHash: string;
  configuration: ManagedProject;
  runtime: AgentConfiguration;
}
export interface Workspace {
  directory: string;
  branch: string;
  baseSha: string;
  instructions: { path: string; text: string }[];
}

export function authorize(
  issue: ReadyIssue,
  config: ManagedProject,
  at: number,
  runtime: AgentConfiguration,
): AuthorizedIssue {
  if (
    issue.repository !== config.repository ||
    !Number.isSafeInteger(issue.number) ||
    issue.number < 1
  ) {
    throw new Error("Issue does not belong to the configured Managed project");
  }
  if (
    !issue.authorization.id ||
    !issue.authorization.actor ||
    issue.authorization.canWrite !== true
  ) {
    throw new Error("Effective write permission could not be confirmed");
  }
  if (
    !issue.authorization.contentUnchanged ||
    !Number.isFinite(Date.parse(issue.authorization.at)) ||
    issue.updatedAt !== issue.authorization.at
  ) {
    throw new Error(
      "Authorization cannot be linked unambiguously to captured content",
    );
  }
  if (
    issue.url !==
    `https://github.com/${config.repository}/issues/${issue.number}`
  ) {
    throw new Error("Untrusted issue link");
  }
  if (!issue.title.trim() || !issue.body.trim()) {
    throw new Error("Complete request and acceptance criteria required");
  }
  return structuredClone({
    ...issue,
    capturedAt: at,
    contentHash: createHash("sha256")
      .update(JSON.stringify([issue.title, issue.body]))
      .digest("hex"),
    configuration: config,
    runtime,
  });
}
