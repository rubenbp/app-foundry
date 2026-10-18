import { isAbsolute } from "node:path";
import type { ManagedProject } from "./request.ts";

export function validateProject(
  value: unknown,
): asserts value is ManagedProject {
  if (!value || typeof value !== "object") {
    throw new Error("Trusted project configuration required");
  }
  const project = value as ManagedProject;
  const text = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0 && !v.includes("\0");
  if (
    !text(project.id) ||
    !text(project.repository) ||
    !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(
      project.repository,
    )
  ) {
    throw new Error("Invalid Managed project repository configuration");
  }
  if (
    !text(project.baseBranch) ||
    !/^[\w][\w./-]*$/.test(project.baseBranch) ||
    /\.\.|\/\/|\/$|\.$|\.lock(?:\/|$)/.test(project.baseBranch)
  ) {
    throw new Error("Invalid base branch configuration");
  }
  if (
    !Array.isArray(project.instructions) ||
    !project.instructions.length ||
    project.instructions.some(
      (p) => !text(p) || isAbsolute(p) || p.split(/[\\/]/).includes(".."),
    )
  ) {
    throw new Error("Invalid trusted instruction paths configuration");
  }
  if (
    !text(project.preparation?.command) ||
    !Array.isArray(project.verification?.commands) ||
    !project.verification.commands.length ||
    !project.verification.commands.every(text)
  ) {
    throw new Error(
      "Preparation and base verification commands required in configuration",
    );
  }
  const relativePath = (path: unknown) =>
    text(path) && !isAbsolute(path) && !path.split(/[\\/]/).includes("..");
  if (
    project.verification.surfaces !== undefined &&
    (!Array.isArray(project.verification.surfaces) ||
      !project.verification.surfaces.every(relativePath))
  ) {
    throw new Error("Invalid verification surface paths configuration");
  }
  const e2e = project.verification.e2e;
  if (e2e) {
    if (
      !text(e2e.command) ||
      !project.verification.commands.includes(e2e.command) ||
      !relativePath(e2e.configFile) ||
      !relativePath(e2e.serves) ||
      !text(e2e.serverCommand) ||
      e2e.reuseExistingServer !== false ||
      typeof e2e.offline !== "boolean"
    ) {
      throw new Error(
        "E2E requires its configured command, build, config and owned server",
      );
    }
    const origin = new URL(e2e.origin);
    if (
      origin.protocol !== "http:" ||
      origin.hostname !== "127.0.0.1" ||
      !origin.port ||
      origin.origin !== e2e.origin
    ) {
      throw new Error(
        "E2E requires a loopback server origin with an explicit port",
      );
    }
  }
  if (
    project.verification.commands.some((command) =>
      /(?:test:e2e|playwright)/.test(command),
    ) &&
    !e2e
  ) {
    throw new Error("E2E command requires an owned build server configuration");
  }
  if (
    project.publication?.provider !== "vercel" ||
    !text(project.publication.projectId) ||
    project.publication.humanMergeRequired !== true
  ) {
    throw new Error(
      "Publication identity and human merge required in configuration",
    );
  }
}
