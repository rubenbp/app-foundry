import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PublicationContext } from "../application/publication/ports.ts";
import type { Preview } from "../domain/publication.ts";
import { remoteCommand, type RemoteCommand } from "./remoteCommand.ts";
import {
  record,
  text,
  sha,
  previewOrigin,
  list,
  number,
} from "./remoteValues.ts";

export interface PreviewAccess {
  discover(context: PublicationContext): Promise<Preview | null>;
  inspect(
    origin: string,
    context: PublicationContext,
  ): Promise<{ projectId: string; repository: string; head: string }>;
  servedHead(
    origin: string,
    context: PublicationContext,
  ): Promise<{ access: Preview["access"]; head: string | null }>;
}

// Las credenciales permanecen en el perfil de CLI de confianza. El código candidato nunca recibe
// tokens, URL autenticadas, cookies ni la salida de la CLI. La protección sigue activa.
export class VercelPreviewAccess implements PreviewAccess {
  private command: RemoteCommand;
  private executable: string;
  private directory: string;

  constructor(
    directory: string,
    command: RemoteCommand = remoteCommand,
    executable = "vercel",
  ) {
    this.command = command;
    this.executable = executable;
    this.directory = directory;
  }

  /** Discover deployments at their source; GitHub deployment notifications are optional. */
  async discover(context: PublicationContext): Promise<Preview | null> {
    const { projectId, teamId } = context.project.publication;
    if (typeof teamId !== "string" || !teamId) {
      throw new Error("Trusted Vercel teamId required for preview discovery");
    }
    const environment =
      context.project.publication.previewEnvironment ?? "Preview";
    if (environment !== "Preview") {
      throw new Error("Configured Vercel environment must be Preview");
    }
    const query = new URLSearchParams({
      teamId,
      projectId,
      sha: context.head,
      limit: "100",
    });
    for (let page = 0; page < 10; page++) {
      const response = record(
        JSON.parse(
          await this.command(this.executable, [
            "api",
            `/v7/deployments?${query}`,
            "--cwd",
            this.directory,
          ]),
        ),
      );
      const matching = list(response.deployments)
        .map(record)
        .filter((entry) => {
          const meta = record(entry.meta ?? {});
          if (meta.githubCommitSha !== context.head) {
            return false;
          }

          return (
            entry.projectId === projectId &&
            `${text(meta.githubCommitOrg)}/${text(meta.githubCommitRepo)}` ===
              context.repository &&
            meta.githubCommitSha === context.head &&
            (entry.target === null || entry.target === "preview") &&
            !entry.customEnvironment
          );
        })
        .toSorted((a, b) => number(b.created) - number(a.created));
      const deployment = matching[0];
      if (deployment) {
        const states: Record<string, Preview["state"]> = {
          READY: "success",
          ERROR: "failure",
          CANCELED: "failure",
          BUILDING: "pending",
          INITIALIZING: "pending",
          QUEUED: "pending",
          BLOCKED: "error",
        };
        const raw = text(deployment.readyState);
        if (!Object.hasOwn(states, raw)) {
          throw new Error("Unknown Vercel deployment state");
        }
        const state = states[raw];
        const preview: Preview = {
          id: text(deployment.uid),
          head: context.head,
          repository: context.repository,
          projectId,
          environment,
          state,
          url: deployment.url
            ? previewOrigin(`https://${text(deployment.url)}`)
            : null,
          access: "pending",
          servedHead: null,
        };
        if (state !== "success" || !preview.url) {
          return preview;
        }
        const identity = await this.inspect(preview.url, context);
        if (
          identity.head !== context.head ||
          identity.repository !== context.repository ||
          identity.projectId !== projectId
        ) {
          throw new Error(
            "Vercel preview identity does not match repository, project and candidate",
          );
        }
        const served = await this.servedHead(preview.url, context);
        preview.access = served.access;
        preview.servedHead = served.head;
        return preview;
      }
      const next = record(response.pagination).next;
      if (next === null) {
        return null;
      }
      const until = number(next);
      if (query.has("until") && until >= Number(query.get("until"))) {
        throw new Error("Vercel deployment pagination did not advance");
      }
      query.set("until", String(until));
    }
    throw new Error("Vercel deployment discovery exceeded pagination limit");
  }

  async inspect(origin: string, context: PublicationContext) {
    const host = new URL(previewOrigin(origin)).hostname;
    const team = context.project.publication.teamId;
    const query =
      typeof team === "string" ? `?teamId=${encodeURIComponent(team)}` : "";
    const deployment = record(
      JSON.parse(
        await this.command(this.executable, [
          "api",
          `/v13/deployments/${encodeURIComponent(host)}${query}`,
          "--cwd",
          this.directory,
        ]),
      ),
    );
    const meta = record(deployment.meta);
    if (
      previewOrigin(`https://${text(deployment.url)}`) !== origin ||
      (deployment.target !== null && deployment.target !== "preview") ||
      deployment.customEnvironment ||
      deployment.readyState !== "READY"
    ) {
      throw new Error("Vercel deployment URL or environment mismatch");
    }
    return {
      projectId: text(deployment.projectId),
      repository: `${text(meta.githubCommitOrg)}/${text(meta.githubCommitRepo)}`,
      head: sha(meta.githubCommitSha),
    };
  }

  async servedHead(origin: string, context: PublicationContext) {
    const team = context.project.publication.teamId;
    if (typeof team !== "string" || !team) {
      throw new Error("Trusted Vercel teamId required for preview access");
    }
    // Un enlace local dedicado a la CLI evita seleccionar un proyecto implícitamente. Estos son
    // identificadores públicos de recursos, no credenciales; no se cambia la configuración de Vercel.
    const directory = join(
      this.directory,
      "vercel-access",
      createHash("sha256")
        .update(context.project.publication.projectId)
        .digest("hex"),
    );
    const linked = join(directory, ".vercel");
    mkdirSync(linked, { recursive: true, mode: 0o700 });
    const pathToLink = join(linked, "project.json");
    const identity = {
      projectId: context.project.publication.projectId,
      orgId: team,
    };
    if (existsSync(pathToLink)) {
      const previous = record(JSON.parse(readFileSync(pathToLink, "utf8")));
      if (
        previous.projectId !== identity.projectId ||
        previous.orgId !== team
      ) {
        throw new Error("Trusted preview CLI link identity changed");
      }
    } else {
      writeFileSync(pathToLink, JSON.stringify(identity), { mode: 0o600 });
    }
    const path = context.project.publication.versionPath ?? "/version.json";
    if (
      typeof path !== "string" ||
      !/^\/[\w./-]+$/.test(path) ||
      path.includes("..")
    ) {
      throw new Error("Trusted version path required");
    }
    // curl escribe el estado después del cuerpo. No se siguen redirecciones: nunca se reenvía
    // la autenticación a una pantalla de inicio de sesión ni a un origen indicado por contenido candidato.
    const output = await this.command(
      this.executable,
      [
        "curl",
        `${previewOrigin(origin)}${path}`,
        "--",
        "--silent",
        "--show-error",
        "--max-time",
        "20",
        "--max-filesize",
        "65536",
        "--write-out",
        "\n%{http_code}",
      ],
      undefined,
      { cwd: directory },
    );
    const split = output.lastIndexOf("\n");
    const status = output.slice(split + 1).trim();
    if (["401", "403", "302", "307", "308"].includes(status)) {
      return { access: "protected" as const, head: null };
    }
    if (status !== "200") {
      throw new Error(`Preview version observation HTTP ${status}`);
    }
    const marker = record(JSON.parse(output.slice(0, split)));
    if (marker.dirty === true) {
      throw new Error("Preview serves a dirty build marker");
    }

    return { access: "verified" as const, head: sha(marker.sha) };
  }
}
