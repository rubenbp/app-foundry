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
  html_url: string;
  updated_at: string;
  state: string;
  labels: { name: string }[];
  pull_request?: unknown;
}
interface Event {
  id: number;
  event: string;
  label?: { name: string };
  actor?: { login: string; type: string };
  created_at: string;
}

// No candidate code or credentials reach this adapter. Only selected facts leave it.
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
    const issues: ReadyIssue[] = [];
    for (const issue of pages.flat().filter((i) => !i.pull_request)) {
      const path = `repos/${repository}/issues/${issue.number}`;
      const events = (
        (await this.api(`${path}/events?per_page=100`)) as Event[][]
      ).flat();
      const label = events
        .filter(
          (e) =>
            e.label?.name === "factory:ready" &&
            ["labeled", "unlabeled"].includes(e.event),
        )
        .at(-1);
      const actor = label?.actor;
      let canWrite: boolean | null = null;
      if (actor && label?.event === "labeled" && actor.type === "User") {
        try {
          const permission = (await this.command([
            "api",
            `repos/${repository}/collaborators/${encodeURIComponent(actor.login)}/permission`,
          ])) as {
            permission: string;
            user?: { permissions?: { push?: boolean } };
          };
          canWrite =
            permission.user?.permissions?.push === true ||
            ["admin", "write", "maintain"].includes(permission.permission);
        } catch {
          /* Missing observation is not authorization. */
        }
      }
      const [owner, name] = repository.split("/");
      const edited = (await this.command([
        "api",
        "graphql",
        "-f",
        "query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){lastEditedAt}}}",
        "-f",
        `owner=${owner}`,
        "-f",
        `name=${name}`,
        "-F",
        `number=${issue.number}`,
      ])) as {
        data?: { repository?: { issue?: { lastEditedAt: string | null } } };
        errors?: unknown;
      };
      const final = (await this.command(["api", path])) as Issue;
      const edit = edited.data?.repository?.issue;
      const contentUnchanged = Boolean(
        label?.event === "labeled" &&
        edit &&
        !edited.errors &&
        (!edit.lastEditedAt ||
          Date.parse(edit.lastEditedAt) < Date.parse(label.created_at)) &&
        !events.some(
          (e) =>
            e.event === "renamed" &&
            Date.parse(e.created_at) >= Date.parse(label.created_at),
        ) &&
        final.state === "open" &&
        final.labels.some((l) => l.name === "factory:ready") &&
        final.title === issue.title &&
        final.body === issue.body &&
        final.updated_at === issue.updated_at &&
        Date.parse(final.updated_at) <= Date.parse(label.created_at),
      );
      issues.push({
        repository,
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        author: issue.user.login,
        url: `https://github.com/${repository}/issues/${issue.number}`,
        updatedAt: final.updated_at,
        authorization: {
          id: label ? String(label.id) : "",
          actor: actor?.login ?? "",
          at: label?.created_at ?? "",
          canWrite,
          contentUnchanged,
        },
      });
    }
    return issues;
  }
}
