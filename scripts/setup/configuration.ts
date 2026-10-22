import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { validateProject } from "../../src/domain/configuration.ts";
import { createTokenPrices } from "../../src/domain/tokenPricing.ts";
import { shellQuote } from "../../src/infrastructure/cli/shellQuote.ts";

export type SetupValues = Record<string, string>;

/** Read only the literal format emitted by the wizard; never source shell code. */
export function readAnswers(path: string): SetupValues {
  const answers: SetupValues = Object.create(null);
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) {
      continue;
    }
    const match = /^([A-Z][A-Z0-9_]*)='(.*)'$/.exec(line);
    if (!match || /[\r\0]/.test(line)) {
      throw new Error(
        "Las respuestas guardadas no son válidas. Repite el wizard.",
      );
    }
    const value = match[2].replaceAll("'\\''", "'");
    if (value.replaceAll("'", "'\\''") !== match[2]) {
      throw new Error("Una respuesta guardada tiene comillas inválidas.");
    }
    answers[match[1]] = value;
  }

  return answers;
}

function required(values: SetupValues, key: string) {
  const value = values[key];
  if (!value?.trim() || /[\n\r\0]/.test(value)) {
    throw new Error(`Falta un valor válido para ${key}.`);
  }

  return value;
}

function list(values: SetupValues, key: string) {
  const items = required(values, key)
    .split("|")
    .map((item) => item.trim());
  if (items.some((item) => !item)) {
    throw new Error(`Hay un elemento vacío en ${key}.`);
  }

  return items;
}

export function setupProject(values: SetupValues) {
  const e2e = required(values, "E2E_ENABLED");
  if (!["si", "no"].includes(e2e)) {
    throw new Error("E2E_ENABLED debe ser si o no.");
  }
  const project = {
    id: required(values, "REPOSITORY").replaceAll("/", "-"),
    repository: required(values, "REPOSITORY"),
    baseBranch: required(values, "BASE_BRANCH"),
    instructions: list(values, "INSTRUCTIONS"),
    preparation: { command: required(values, "INSTALL_COMMAND") },
    verification: {
      commands: list(values, "CHECK_COMMANDS"),
      ...(e2e === "si"
        ? {
            e2e: {
              command: required(values, "E2E_COMMAND"),
              configFile: required(values, "E2E_CONFIG"),
              serverCommand: required(values, "E2E_SERVER"),
              origin: required(values, "E2E_ORIGIN"),
              serves: required(values, "BUILD_DIRECTORY"),
              reuseExistingServer: false as const,
              offline: false,
            },
          }
        : {}),
    },
    publication: {
      provider: "vercel" as const,
      teamId: required(values, "VERCEL_TEAM_ID"),
      projectId: required(values, "VERCEL_PROJECT_ID"),
      projectName: required(values, "VERCEL_PROJECT"),
      previewEnvironment: "Preview",
      versionPath: required(values, "VERSION_PATH"),
      commitVariable: "VERCEL_GIT_COMMIT_SHA",
      requiredStatusCheck: "Vercel",
      requireUpToDateBranch: true,
      humanMergeRequired: true as const,
    },
  };
  validateProject(project);
  if (
    !/^team_[\w]+$/.test(project.publication.teamId) ||
    !/^prj_[\w]+$/.test(project.publication.projectId)
  ) {
    throw new Error(
      "Los identificadores de equipo o proyecto de Vercel no son válidos.",
    );
  }
  if (
    !/^\/[\w./-]+$/.test(project.publication.versionPath) ||
    project.publication.versionPath.includes("..")
  ) {
    throw new Error("La ruta del marcador de versión no es válida.");
  }

  return project;
}

export function setupConfig(values: SetupValues, root: string) {
  const price = (key: string) => {
    const input = required(values, key);
    if (!/^(?:\d+\.?\d*|\.\d+)$/.test(input)) {
      throw new Error(
        `${key}: introduce una tarifa USD no negativa con punto decimal.`,
      );
    }

    return Number(input);
  };
  const provider = required(values, "PROVIDER");
  if (!["openai", "google", "anthropic", "ollama"].includes(provider)) {
    throw new Error("El proveedor no está admitido.");
  }
  const model = required(values, "MODEL");
  if (!/^[^\s#]+$/.test(model)) {
    throw new Error(
      "Usa el ID del modelo sin prefijo de proveedor ni #variante.",
    );
  }
  const effort = required(values, "REASONING_EFFORT");
  const cli = required(values, "OPENCODE_CLI");
  const vercelCli = required(values, "VERCEL_CLI");
  if (![root, cli, vercelCli].every(isAbsolute)) {
    throw new Error(
      "Las rutas de instalación y de las CLI deben ser absolutas.",
    );
  }

  return {
    dataDir: join(root, "data"),
    provider,
    model,
    auth: "opencode",
    ...(provider !== "ollama" ? { opencodeCli: cli } : {}),
    vercelCli,
    ...(effort !== "default" ? { reasoningEffort: effort } : {}),
    tokenPrices: createTokenPrices({
      inputUsdPerMillion: price("INPUT_PRICE"),
      outputUsdPerMillion: price("OUTPUT_PRICE"),
      cacheReadUsdPerMillion: price("CACHE_PRICE"),
    }),
    managedProjectFile: "managed-project.json",
  };
}

/** Atomic replacement of an owned regular file; refuse symlinks. */
export function writeSetupFile(path: string, content: string, mode = 0o600) {
  if (existsSync(path) && !lstatSync(path).isFile()) {
    throw new Error(
      `No se sobrescribirá un archivo que no sea regular: ${path}`,
    );
  }
  // lstat also catches dangling symlinks that existsSync deliberately ignores.
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`No se escribirá a través del enlace simbólico: ${path}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, { mode, flag: "wx" });
  try {
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function launcher(
  root: string,
  node: string,
  path: string,
  port: string,
) {
  if (
    !isAbsolute(root) ||
    !isAbsolute(node) ||
    !/^\d+$/.test(port) ||
    Number(port) < 1024 ||
    Number(port) > 65535 ||
    [root, node, path].some((value) => /[\0\r\n]/.test(value))
  ) {
    throw new Error(
      "Las rutas o el puerto del lanzador no son válidos (1024–65535).",
    );
  }

  return `#!/bin/bash
set -euo pipefail
export PATH=${shellQuote(path)}:"$PATH"
cd -- ${shellQuote(join(root, "factory"))}
exec ${shellQuote(node)} --experimental-strip-types src/cli.ts serve \\
  --config ${shellQuote(join(root, "factory.local.json"))} --port ${shellQuote(port)}
`;
}

/** Proposed defaults come from repository files; scripts are displayed, not run. */
export function projectDefaults(directory: string): SetupValues {
  const packagePath = join(directory, "package.json");
  const pkg = existsSync(packagePath)
    ? JSON.parse(readFileSync(packagePath, "utf8"))
    : {};
  const manager =
    typeof pkg.packageManager === "string"
      ? pkg.packageManager.split("@")[0]
      : existsSync(join(directory, "pnpm-lock.yaml"))
        ? "pnpm"
        : existsSync(join(directory, "yarn.lock"))
          ? "yarn"
          : "npm";
  if (!["npm", "pnpm", "yarn"].includes(manager)) {
    throw new Error(
      "Este gestor necesita un contrato de proyecto preparado manualmente.",
    );
  }
  const scripts = pkg.scripts ?? {};
  const names = ["build", "lint", "typecheck", "test:unit", "test:e2e"].filter(
    (name) => typeof scripts[name] === "string",
  );
  const e2eConfig = [
    "playwright.config.ts",
    "playwright.config.mjs",
    "playwright.config.js",
  ].find((name) => existsSync(join(directory, name)));

  return {
    INSTALL_COMMAND:
      manager === "npm"
        ? "npm ci"
        : manager === "pnpm"
          ? "pnpm install --frozen-lockfile"
          : "yarn install --immutable",
    CHECK_COMMANDS: names.map((name) => `${manager} run ${name}`).join("|"),
    INSTRUCTIONS: ["AGENTS.md", "README.md"]
      .filter((name) => existsSync(join(directory, name)))
      .join("|"),
    E2E_ENABLED: names.includes("test:e2e") ? "si" : "no",
    E2E_COMMAND: `${manager} run test:e2e`,
    E2E_CONFIG: e2eConfig ?? "",
  };
}

export function containedFile(directory: string, path: string) {
  const target = resolve(directory, path);
  if (!target.startsWith(resolve(directory) + sep)) {
    throw new Error("La ruta del proyecto sale del repositorio.");
  }

  return target;
}
