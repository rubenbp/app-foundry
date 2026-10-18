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
  previewOrigin,
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

  private async deployment(
    context: PublicationContext,
  ): Promise<Preview | null> {
    const environment =
      context.project.publication.previewEnvironment ?? "Preview";
    if (typeof environment !== "string" || !environment) {
      throw new Error("Configured deployment environment required");
    }
    const deployments = await this.pages(
      `repos/${context.repository}/deployments?sha=${context.head}&environment=${encodeURIComponent(environment)}&per_page=100`,
    );
    const matching = deployments
      .map(record)
      .filter(
        (deployment) =>
          deployment.sha === context.head &&
          deployment.environment === environment &&
          deployment.repository_url ===
            `https://api.github.com/repos/${context.repository}` &&
          record(deployment.creator).login === "vercel[bot]",
      );
    const deployment = matching.sort((a, b) => number(b.id) - number(a.id))[0];
    if (!deployment) {
      return null;
    }
    const id = number(deployment.id);
    const statuses = await this.pages(
      `repos/${context.repository}/deployments/${id}/statuses?per_page=100`,
    );
    const latest = statuses
      .map(record)
      .sort((a, b) => number(b.id) - number(a.id))[0];
    const raw = latest?.state ?? "pending";
    const state =
      raw === "success" ||
      raw === "failure" ||
      raw === "error" ||
      raw === "inactive"
        ? raw
        : ["pending", "queued", "in_progress"].includes(text(raw))
          ? "pending"
          : null;
    if (!state) {
      throw new Error("Unknown deployment state");
    }
    const preview: Preview = {
      id: String(id),
      head: context.head,
      repository: context.repository,
      projectId: "unconfirmed",
      environment,
      state,
      url: latest?.environment_url
        ? previewOrigin(latest.environment_url)
        : null,
      access: "pending",
      servedHead: null,
    };
    if (state !== "success" || !preview.url) {
      return preview;
    }
    const identity = await this.access.inspect(preview.url, context);
    preview.projectId = identity.projectId;
    if (
      identity.head !== context.head ||
      identity.repository !== context.repository ||
      identity.projectId !== context.project.publication.projectId
    ) {
      throw new Error(
        "Vercel preview identity does not match repository, project and candidate",
      );
    }
    const served = await this.access.servedHead(preview.url, context);
    preview.access = served.access;
    preview.servedHead = served.head;
    return preview;
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
        preview = await this.deployment(context);
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
    // Usa la URL de confianza, nunca el pushurl del clon. Una concesión sin objetos rechaza
    // una rama creada en paralelo. Primero se reconcilian las referencias coincidentes existentes.
    await this.git(
      context,
      [
        "push",

        `--force-with-lease=refs/heads/${context.workspace.branch}:`,
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
        title: `Factory: candidate for issue #${context.issue}`,
        body: `Issue: https://github.com/${context.repository}/issues/${context.issue}\nEjecución: ${context.runId}\n\nLa Factory publicará el informe cuando la preview del Commit candidato esté verificada. El merge y la publicación requieren aceptación humana de esa versión.`,
        head: context.workspace.branch,
        base: context.project.baseBranch,
      }),
      context,
    );
  }

  async comment(context: PublicationContext, body: string) {
    if (!context.pull) {
      throw new Error("PR required for publication report");
    }
    return this.conversation(
      await this.api(
        `repos/${context.repository}/issues/${context.pull.number}/comments`,
        { body },
      ),
      context,
      "pull",
      context.pull.number,
    );
  }

  async status(
    context: PublicationContext,
    state: "pending" | "success" | "failure" | "error",
  ) {
    await this.api(`repos/${context.repository}/statuses/${context.head}`, {
      state,
      context: mergeContext,
      description:
        state === "success"
          ? "SHA y preview aceptados; merge humano pendiente"
          : "Aceptación vigente y evidencia completa requeridas",
      target_url:
        context.pull?.url ??
        `https://github.com/${context.repository}/issues/${context.issue}`,
    });
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
