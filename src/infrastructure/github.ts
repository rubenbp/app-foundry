import type { GitHubPort } from "../application/ports.ts";
import type { ReadyIssue } from "../domain/request.ts";
import { issueLabels, type IssueLabel } from "../domain/issueLabels.ts";
import { remoteCommand } from "./remoteCommand.ts";
import { list, record, text } from "./remoteValues.ts";

export type GitHubCommand = (
  args: string[],
  input?: unknown,
) => Promise<unknown>;
const command: GitHubCommand = async (args, input) => {
  const output = await remoteCommand("gh", args, input);

  return output.trim() ? (JSON.parse(output) as unknown) : null;
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

  private async write(path: string, method: string, body?: unknown) {
    return this.command(
      [
        "api",
        path,
        "--method",
        method,
        ...(body === undefined ? [] : ["--input", "-"]),
      ],
      body,
    );
  }

  async setRunLabel(repository: string, issue: number, label: IssueLabel) {
    const path = `repos/${repository}`;
    const labelsPath = `${path}/issues/${issue}/labels`;
    const names = (value: unknown) =>
      list(value)
        .flatMap(list)
        .map((value) => text(record(value).name));
    const current = names(await this.api(`${labelsPath}?per_page=100`));
    if (!current.includes(label)) {
      const defined = names(await this.api(`${path}/labels?per_page=100`));
      if (!defined.includes(label)) {
        try {
          await this.write(`${path}/labels`, "POST", {
            name: label,
            ...issueLabels[label],
          });
        } catch (error) {
          // Otra escritura o una respuesta perdida puede haber creado ya la definición.
          if (
            !names(await this.api(`${path}/labels?per_page=100`)).includes(
              label,
            )
          ) {
            throw error;
          }
        }
      }
      await this.write(labelsPath, "POST", { labels: [label] });
    }
    // Añade primero el estado nuevo. Solo elimina los nombres que pertenecen al contrato.
    for (const previous of current) {
      if (previous !== label && Object.hasOwn(issueLabels, previous)) {
        await this.write(
          `${labelsPath}/${encodeURIComponent(previous)}`,
          "DELETE",
        );
      }
    }
  }
}
