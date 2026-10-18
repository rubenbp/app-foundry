import type { IssueConversation } from "../application/issueConversation.ts";
import type { IssueComment } from "../domain/intervention.ts";
import { remoteCommand, type RemoteCommand } from "./remoteCommand.ts";
import {
  record,
  list,
  number,
  text,
  timestamp,
  githubUrl,
} from "./remoteValues.ts";

export class GitHubIssueConversation implements IssueConversation {
  private command: RemoteCommand;

  constructor(command: RemoteCommand = remoteCommand) {
    this.command = command;
  }

  private decode(
    value: unknown,
    repository: string,
    issue: number,
  ): IssueComment {
    const comment = record(value);
    const user = record(comment.user);
    const id = number(comment.id);

    return {
      id: String(id),
      url: githubUrl(
        comment.html_url,
        `https://github.com/${repository}/issues/${issue}#issuecomment-${id}`,
      ),
      body: text(comment.body),
      author: text(user.login),
      human: user.type === "User" && !comment.performed_via_github_app,
      createdAt: timestamp(comment.created_at),
    };
  }

  async comments(repository: string, issue: number) {
    const pages: unknown = JSON.parse(
      await this.command("gh", [
        "api",
        `repos/${repository}/issues/${issue}/comments?per_page=100`,
        "--paginate",
        "--slurp",
      ]),
    );

    return list(pages)
      .flatMap(list)
      .map((value) => this.decode(value, repository, issue));
  }

  async comment(repository: string, issue: number, body: string) {
    const value: unknown = JSON.parse(
      await this.command(
        "gh",
        [
          "api",
          `repos/${repository}/issues/${issue}/comments`,
          "--method",
          "POST",
          "--input",
          "-",
        ],
        { body },
      ),
    );

    return this.decode(value, repository, issue);
  }

  async close(repository: string, issue: number) {
    await this.command(
      "gh",
      [
        "api",
        `repos/${repository}/issues/${issue}`,
        "--method",
        "PATCH",
        "--input",
        "-",
      ],
      {
        state: "closed",
        state_reason: "not_planned",
      },
    );
  }
}
