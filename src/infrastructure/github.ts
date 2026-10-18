import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitHubPort } from "../application/ports.ts";
import type { ReadyIssue } from "../domain/request.ts";

export type GitHubCommand = (args: string[]) => Promise<unknown>;
const command: GitHubCommand = async (args) => {
  const { stdout } = await promisify(execFile)("gh", args, {
    timeout: 30_000,
    maxBuffer: 16_000_000,
  });

  return JSON.parse(stdout);
};
interface Issue {
  number: number;
  title: string;
  body: string | null;
  user: { login: string };
  state: string;
  labels: { name: string }[];
  pull_request?: unknown;
}

// Ningún código candidato ni credencial llega a este adaptador. Solo salen los datos seleccionados.
export class GitHub implements GitHubPort {
  private command: GitHubCommand;

  constructor(run: GitHubCommand = command) {
    this.command = run;
  }

  private async api(path: string) {
    return this.command(["api", path, "--paginate", "--slurp"]);
  }

  async ready(repository: string): Promise<ReadyIssue[]> {
    const pages = (await this.api(
      `repos/${repository}/issues?state=open&labels=factory%3Aready&per_page=100`,
    )) as Issue[][];

    return pages
      .flat()
      .filter(
        (issue) =>
          !issue.pull_request &&
          issue.state === "open" &&
          issue.labels.some((label) => label.name === "factory:ready"),
      )
      .map((issue) => ({
        repository,
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        author: issue.user.login,
        url: `https://github.com/${repository}/issues/${issue.number}`,
      }));
  }
}
