import type { PermissionRuleset, SkillInfo } from "@opencode/client";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

export interface FactorySkills {
  directory: string;
  entries: { id: string; path: string }[];
}

// La copia publicada se reutiliza en los siguientes Intentos y reinicios.
export function snapshotSkills(source: string, runtime: string): FactorySkills {
  const destination = join(runtime, "skills");
  if (!existsSync(destination)) {
    mkdirSync(runtime, { recursive: true, mode: 0o700 });
    const staging = mkdtempSync(join(runtime, "skills-staging-"));
    try {
      cpSync(source, staging, { recursive: true, dereference: true });
      renameSync(staging, destination);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
  const directory = realpathSync(destination);
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(join(directory, entry.name, "SKILL.md")))
    .map((entry) => {
      const path = join(directory, entry.name, "SKILL.md");
      if (
        !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.name) ||
        !statSync(path).isFile()
      ) {
        throw new Error(`Invalid Factory skill: ${entry.name}`);
      }

      return { id: entry.name, path };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return { directory, entries };
}

export function skillPermissions(skills: FactorySkills): PermissionRuleset {
  return [
    { action: "skill", resource: "*", effect: "deny" },
    ...skills.entries.map(({ id }) => ({
      action: "skill",
      resource: id,
      effect: "allow" as const,
    })),
    {
      action: "external_directory",
      resource: `${skills.directory}/*`,
      effect: "allow",
    },
    { action: "edit", resource: `${skills.directory}/*`, effect: "deny" },
  ];
}

// Los permisos nativos distinguen IDs, no procedencia. Se comprueba la definición efectiva.
export function verifySkills(
  skills: FactorySkills,
  available: Pick<SkillInfo, "id" | "path">[],
) {
  for (const expected of skills.entries) {
    const actual = available.find((skill) => skill.id === expected.id);
    if (!actual || realpathSync(actual.path) !== expected.path) {
      throw new Error(
        `Effective Factory skill differs from execution snapshot: ${expected.id}`,
      );
    }
  }
}
