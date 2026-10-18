import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PublicationContext } from "../application/publication/ports.ts";
import type { Preview } from "../domain/publication.ts";
import { remoteCommand, type RemoteCommand } from "./remoteCommand.ts";
import { record, text, sha, previewOrigin } from "./remoteValues.ts";

export interface PreviewAccess {
  inspect(
    origin: string,
    context: PublicationContext,
    target?: "preview" | "production",
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

  async inspect(
    origin: string,
    context: PublicationContext,
    target: "preview" | "production" = "preview",
  ) {
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
      (target === "production"
        ? deployment.target !== "production"
        : deployment.target !== null && deployment.target !== "preview") ||
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
