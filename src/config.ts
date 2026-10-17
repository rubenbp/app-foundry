import { readFileSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FactoryConfig } from "./types.ts";

export function readConfig(path: string): FactoryConfig {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object")
    throw new Error("Configuration must be an object");
  const config = value as Record<string, unknown>;
  for (const key of ["dataDir", "projectDir", "provider", "model"])
    if (typeof config[key] !== "string" || !config[key])
      throw new Error(`Missing ${key}`);
  if (
    config.auth !== "opencode" ||
    config.provider !== "openai" ||
    config.model !== "gpt-6-luna"
  )
    throw new Error(
      "Supported preparation: openai/gpt-6-luna with OpenCode OAuth",
    );
  if (typeof config.opencodeCli !== "string" || !isAbsolute(config.opencodeCli))
    throw new Error(
      "opencodeCli must identify the absolute OpenCode CLI path supporting auth export",
    );
  if (
    !isAbsolute(String(config.dataDir)) ||
    !isAbsolute(String(config.projectDir))
  )
    throw new Error("dataDir and projectDir must be absolute");
  const projectDir = realpathSync(String(config.projectDir));
  mkdirSync(String(config.dataDir), { recursive: true, mode: 0o700 });
  const dataDir = realpathSync(String(config.dataDir));
  for (const codeDir of [
    realpathSync(resolve(import.meta.dirname, "..")),
    projectDir,
  ]) {
    const child = relative(codeDir, dataDir);
    const parent = relative(dataDir, codeDir);
    if (
      !child ||
      (!child.startsWith(".." + sep) && child !== "..") ||
      (!parent.startsWith(".." + sep) && parent !== "..")
    )
      throw new Error(
        "Data root must be separate from Factory code and Managed project",
      );
  }
  return {
    dataDir,
    projectDir,
    provider: String(config.provider),
    model: String(config.model),
    auth: "opencode",
    opencodeCli: config.opencodeCli,
  };
}
