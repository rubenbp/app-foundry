import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  PublicationContext,
  PublicationFacts,
  PublicationPort,
} from "../application/publication/ports.ts";
import { mergeContext } from "../domain/publication.ts";
import type {
  ConversationComment,
  Preview,
  PullCandidate,
} from "../domain/publication.ts";
import { GitWorkspace } from "./workspace.ts";
import { execute, reducedEnvironment, type ProcessPort } from "./process.ts";

import { remoteCommand, type RemoteCommand } from "./remoteCommand.ts";
import {
  record,
  text,
  number,
  list,
  sha,
  timestamp,
  githubUrl,
} from "./remoteValues.ts";
import { VercelPreviewAccess, type PreviewAccess } from "./vercelPreview.ts";

export class GitHubPublication implements PublicationPort {
  private command: RemoteCommand;
  private process: ProcessPort;
  private root: string;
  private access: PreviewAccess;

  constructor(
    root: string,
    options: {
      command?: RemoteCommand;
      process?: ProcessPort;
      access?: PreviewAccess;
      vercelCli?: string;
    } = {},
  ) {
    this.root = root;
    this.command = options.command ?? remoteCommand;
    this.process = options.process ?? execute;
    this.access =
      options.access ??
      new VercelPreviewAccess(root, this.command, options.vercelCli);
  }

  private async api(path: string, body?: unknown) {
    return JSON.parse(
      await this.command(
        "gh",
        [
          "api",
          path,
          ...(body === undefined ? [] : ["--method", "POST", "--input", "-"]),
        ],
        body,
      ),
    ) as unknown;
  }

  private async pages(path: string) {
    const value: unknown = JSON.parse(
      await this.command("gh", ["api", path, "--paginate", "--slurp"]),
    );

    return list(value).flatMap(list);
  }

  private pull(value: unknown, context: PublicationContext): PullCandidate {
    const pull = record(value);
    const head = record(pull.head);
    const base = record(pull.base);
    const id = number(pull.number);
    if (
      record(head.repo).full_name !== context.repository ||
      record(base.repo).full_name !== context.repository ||
      head.ref !== context.workspace.branch ||
      base.ref !== context.project.baseBranch
    ) {
      throw new Error("PR repository, branch or base mismatch");
    }
    return {
      number: id,
      url: githubUrl(
        pull.html_url,
        `https://github.com/${context.repository}/pull/${id}`,
      ),
      head: sha(head.sha),
      base: text(base.ref),
      open: pull.state === "open",
      merged: pull.merged === true || typeof pull.merged_at === "string",
      ...(pull.merged_at ? { mergedAt: timestamp(pull.merged_at) } : {}),
      ...(pull.merged_by && record(pull.merged_by).type === "User"
        ? { mergedBy: text(record(pull.merged_by).login) }
        : {}),
      ...(pull.merge_commit_sha
        ? { mergeSha: sha(pull.merge_commit_sha) }
        : {}),
    };
  }

  private conversation(
    value: unknown,
    context: PublicationContext,
    source: "issue" | "pull",
    target: number,
  ): ConversationComment {
    const comment = record(value);
    const user = record(comment.user);
    const id = number(comment.id);

    return {
      id: String(id),
      url: githubUrl(
        comment.html_url,
        `https://github.com/${context.repository}/${source === "pull" ? "pull" : "issues"}/${target}#issuecomment-${id}`,
      ),
      body: text(comment.body),
      author: text(user.login),
      human: user.type === "User" && !comment.performed_via_github_app,

      createdAt: timestamp(comment.created_at),
      updatedAt: timestamp(comment.updated_at),
      source,
    };
  }

  async inspect(
    context: PublicationContext,
    options = { preview: true },
  ): Promise<PublicationFacts> {
    const path = `repos/${context.repository}`;
    const owner = context.repository.split("/")[0];
    const [requestValue, pulls, refs, issueComments] = await Promise.all([
      this.api(`${path}/issues/${context.issue}`),
      this.pages(
        `${path}/pulls?state=all&head=${encodeURIComponent(`${owner}:${context.workspace.branch}`)}&base=${encodeURIComponent(context.project.baseBranch)}&per_page=100`,
      ),
      this.pages(
        `${path}/git/matching-refs/heads/${encodeURIComponent(context.workspace.branch)}`,
      ),
      this.pages(`${path}/issues/${context.issue}/comments?per_page=100`),
    ]);
    const request = record(requestValue);
    const candidates = pulls.map((value) => this.pull(value, context));
    if (candidates.length > 1) {
      throw new Error(
        "Multiple PRs for the execution branch; inspect manually",
      );
    }
    let pull = candidates[0] ?? null;
    if (pull?.merged) {
      pull = this.pull(await this.api(`${path}/pulls/${pull.number}`), context);
    }
    let preview: Preview | null = null;
    let previewError: unknown;
    if (options.preview && !pull?.merged) {
      try {
        preview = await this.access.discover(context);
      } catch (error) {
        previewError = error;
      }
    }
    const ref = refs
      .map(record)
      .find((value) => value.ref === `refs/heads/${context.workspace.branch}`);
    // Antes del primer envío, es posible que este commit aún no exista en GitHub.
    const statusValues =
      ref || pull
        ? await this.pages(
            `${path}/commits/${context.head}/statuses?per_page=100`,
          )
        : [];
    const comments = issueComments.map((value) =>
      this.conversation(value, context, "issue", context.issue),
    );
    if (pull) {
      comments.push(
        ...(
          await this.pages(
            `${path}/issues/${pull.number}/comments?per_page=100`,
          )
        ).map((value) =>
          this.conversation(value, context, "pull", pull.number),
        ),
      );
    }
    // La consulta de la vista previa puede terminar después de la integración humana. Reconcilia la PR tras todas
    // las lecturas dependientes antes de considerar que una vista previa retirada indica un fallo del candidato.
    if (pull && options.preview && !pull.merged) {
      pull = this.pull(await this.api(`${path}/pulls/${pull.number}`), context);
    }
    if (pull?.merged) {
      preview = null;
    } else if (previewError) {
      throw previewError;
    }
    const statuses = statusValues
      .map(record)
      .filter((value) => value.context === mergeContext)
      .map((value): NonNullable<PublicationFacts["mergeStatus"]> => {
        const state = text(value.state);
        if (
          state !== "pending" &&
          state !== "success" &&
          state !== "failure" &&
          state !== "error"
        ) {
          throw new Error("Unknown commit status");
        }
        return { head: context.head, state, at: timestamp(value.created_at) };
      });
    const status = statuses[0] ?? null;
    const mergeStatus = pull?.mergedAt
      ? (statuses.find((value) => value.at <= pull.mergedAt!) ?? null)
      : null;

    return {
      request: {
        open: request.state === "open",
      },
      remoteHead: ref ? sha(record(ref.object).sha) : null,

      pull,
      comments,
      preview,
      status,
      mergeStatus,
    };
  }

  async commentIssue(context: PublicationContext, body: string) {
    return this.conversation(
      await this.api(
        `repos/${context.repository}/issues/${context.issue}/comments`,
        { body },
      ),
      context,
      "issue",
      context.issue,
    );
  }

  async closeIssue(context: PublicationContext) {
    await this.command(
      "gh",
      [
        "api",
        `repos/${context.repository}/issues/${context.issue}`,
        "--method",
        "PATCH",
        "--input",
        "-",
      ],
      { state: "closed", state_reason: "completed" },
    );
  }

  private async git(
    context: PublicationContext,
    args: string[],
    authenticated = false,
  ) {
    await new GitWorkspace(this.root, this.process).validate(
      context.workspace,
      context.project,
    );
    const home = join(this.root, "publication-home");
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const env = reducedEnvironment(home);
    if (authenticated) {
      Object.assign(env, {
        HOME: process.env.HOME,
        GH_TOKEN: process.env.GH_TOKEN,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        GIT_CONFIG_COUNT: "3",
        GIT_CONFIG_KEY_2: "credential.helper",
        GIT_CONFIG_VALUE_2: "!gh auth git-credential",
      });
    }
    const result = await this.process(
      "git",
      ["-c", "core.hooksPath=/dev/null", ...args],
      {
        cwd: context.workspace.directory,
        env,
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (result.code !== 0 || result.truncated || result.forcedStop) {
      throw new Error(
        `Publication Git operation unconfirmed: ${result.output}`,
      );
    }
    return result.output.trim();
  }

  async push(context: PublicationContext) {
    if (
      (await this.git(context, ["rev-parse", "HEAD"])) !== context.head ||
      (await this.git(context, ["status", "--porcelain"]))
    ) {
      throw new Error("Candidate changed after verification");
    }
    // La concesión espera una rama ausente al publicar por primera vez, o el SHA
    // anterior al publicar una corrección sobre la misma rama.
    await this.git(
      context,
      [
        "push",

        `--force-with-lease=refs/heads/${context.workspace.branch}:${context.previousHead ?? ""}`,
        "--",
        `https://github.com/${context.repository}.git`,
        `${context.head}:refs/heads/${context.workspace.branch}`,
      ],
      true,
    );
  }

  async prepareHead(context: PublicationContext, head: string) {
    sha(head);
    if (await this.git(context, ["status", "--porcelain"])) {
      throw new Error("Uncommitted changes prevent replacing candidate head");
    }
    await this.git(
      context,
      [
        "fetch",
        "--no-tags",
        "--",
        `https://github.com/${context.repository}.git`,
        `refs/heads/${context.workspace.branch}`,
      ],
      true,
    );
    if ((await this.git(context, ["rev-parse", "FETCH_HEAD"])) !== head) {
      throw new Error("Remote head changed during fetch");
    }
    await this.git(context, [
      "merge-base",
      "--is-ancestor",
      context.workspace.baseSha,
      head,
    ]);
    await this.git(context, ["reset", "--hard", head]);
  }

  async openPull(context: PublicationContext) {
    return this.pull(
      await this.api(`repos/${context.repository}/pulls`, {
        ...context.description,
        head: context.workspace.branch,
        base: context.project.baseBranch,
      }),
      context,
    );
  }

  async updatePull(context: PublicationContext) {
    if (!context.pull) {
      throw new Error("PR required to update its description");
    }
    return this.pull(
      JSON.parse(
        await this.command(
          "gh",
          [
            "api",
            `repos/${context.repository}/pulls/${context.pull.number}`,
            "--method",
            "PATCH",
            "--input",
            "-",
          ],
          context.description,
        ),
      ) as unknown,
      context,
    );
  }

  async status(
    context: PublicationContext,
    state: "pending" | "success" | "failure" | "error",
  ) {
    const result = record(
      await this.api(`repos/${context.repository}/statuses/${context.head}`, {
        state,
        context: mergeContext,
        description:
          state === "success"
            ? "Verificaciones y preview listas; revisión y merge humanos pendientes"
            : "Verificaciones y preview vigentes requeridas",
        target_url:
          context.pull?.url ??
          `https://github.com/${context.repository}/issues/${context.issue}`,
      }),
    );

    return { at: timestamp(result.created_at) };
  }

  async canWrite(repository: string, author: string) {
    const permission = record(
      await this.api(
        `repos/${repository}/collaborators/${encodeURIComponent(author)}/permission`,
      ),
    );

    return (
      ["admin", "write", "maintain"].includes(text(permission.permission)) ||
      (permission.user &&
        record(record(permission.user).permissions).push === true) === true
    );
  }
}
