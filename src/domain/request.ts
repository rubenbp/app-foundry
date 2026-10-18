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
    humanMergeRequired: true;
    previewEnvironment?: string;
    [key: string]: unknown;
  };
}
/** Open issue returned by GitHub's factory:ready query; no actor accreditation is required. */
export interface ReadyIssue {
  repository: string;
  number: number;
  title: string;
  body: string;
  author: string;
  url: string;
}
export interface AgentConfiguration {
  provider: string;
  model: string;
  auth: "opencode";
  opencodeCli?: string;
}
export interface AuthorizedIssue extends ReadyIssue {
  capturedAt: number;
  configuration: ManagedProject;
  runtime: AgentConfiguration;
}
export interface Workspace {
  directory: string;
  branch: string;
  baseSha: string;
  instructions: { path: string; text: string }[];
}

export function captureIssue(
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
    issue.url !==
    `https://github.com/${config.repository}/issues/${issue.number}`
  ) {
    throw new Error("Untrusted issue link");
  }
  return structuredClone({
    repository: issue.repository,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    author: issue.author,
    url: issue.url,
    capturedAt: at,
    configuration: config,
    runtime,
  });
}
