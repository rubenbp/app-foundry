import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import type { FactoryConfig } from "../../src/application/configuration.ts";
import { sanitizer } from "../../src/application/sanitize.ts";
import type { ManagedProject } from "../../src/domain/request.ts";
import { verificationPlan } from "../../src/domain/verification.ts";
import { issueLabels, type IssueLabel } from "../../src/domain/issueLabels.ts";
import { mergeContext } from "../../src/domain/publication.ts";
import { OpenCode } from "../../src/infrastructure/opencode/agent.ts";
import {
  remoteCommand,
  type RemoteCommand,
} from "../../src/infrastructure/remoteCommand.ts";
import { list, record, text } from "../../src/infrastructure/remoteValues.ts";
import { GitWorkspace } from "../../src/infrastructure/workspace.ts";
import { CandidateVerifier } from "../../src/infrastructure/verification.ts";
import { execute, type ProcessPort } from "../../src/infrastructure/process.ts";
import { containedFile } from "./configuration.ts";

export async function checkGithub(
  project: Pick<ManagedProject, "repository" | "baseBranch">,
  command: RemoteCommand = remoteCommand,
) {
  const repository = record(
    JSON.parse(await command("gh", ["api", `repos/${project.repository}`])),
  );
  const permissions = record(repository.permissions);
  if (
    repository.full_name !== project.repository ||
    permissions.push !== true ||
    repository.has_issues !== true ||
    repository.archived === true
  ) {
    throw new Error(
      "El repositorio debe estar activo, permitir escritura y tener Issues habilitado.",
    );
  }
  await command("gh", [
    "api",
    `repos/${project.repository}/branches/${encodeURIComponent(project.baseBranch)}`,
  ]);
}

async function definedIssueLabels(repository: string, command: RemoteCommand) {
  return new Set(
    list(
      JSON.parse(
        await command("gh", [
          "api",
          "--paginate",
          "--slurp",
          `repos/${repository}/labels?per_page=100`,
        ]),
      ),
    )
      .flatMap(list)
      .map((label) => text(record(label).name)),
  );
}

/** Create missing Factory labels. Existing names keep their color and description. */
export async function ensureIssueLabels(
  repository: string,
  command: RemoteCommand = remoteCommand,
) {
  if (
    !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(
      repository,
    )
  ) {
    throw new Error("Repositorio inválido.");
  }
  const defined = await definedIssueLabels(repository, command);
  const created: IssueLabel[] = [];
  const present: IssueLabel[] = [];
  for (const name of Object.keys(issueLabels) as IssueLabel[]) {
    if (defined.has(name)) {
      present.push(name);
      continue;
    }
    const definition = issueLabels[name];
    try {
      await command(
        "gh",
        [
          "api",
          `repos/${repository}/labels`,
          "--method",
          "POST",
          "--input",
          "-",
        ],
        {
          name,
          color: definition.color,
          description: definition.description,
        },
      );
    } catch (error) {
      if (!(await definedIssueLabels(repository, command)).has(name)) {
        throw error;
      }
      present.push(name);
      continue;
    }
    created.push(name);
  }
  console.log(
    created.length
      ? `Etiquetas creadas: ${created.join(", ")}`
      : "Las etiquetas de la Factory ya existen.",
  );
  if (present.length && created.length) {
    console.log(`Ya existían: ${present.join(", ")}`);
  }
}

export async function checkProtection(
  project: ManagedProject,
  command: RemoteCommand = remoteCommand,
) {
  const protection = record(
    JSON.parse(
      await command("gh", [
        "api",
        `repos/${project.repository}/branches/${encodeURIComponent(project.baseBranch)}/protection`,
      ]),
    ),
  );
  const checks = record(protection.required_status_checks);
  const contexts = checks.contexts;
  if (
    !protection.required_pull_request_reviews ||
    checks.strict !== true ||
    !Array.isArray(contexts) ||
    !contexts.includes("Vercel") ||
    !contexts.includes(mergeContext) ||
    record(protection.enforce_admins).enabled !== true
  ) {
    throw new Error(
      "La protección debe exigir PR, rama actualizada y checks de Vercel y Factory, también para administradores.",
    );
  }
}

export async function checkVercel(
  project: ManagedProject,
  executable: string,
  directory: string,
  command: RemoteCommand = remoteCommand,
) {
  const identity = record(
    JSON.parse(
      await command(executable, [
        "api",
        `/v9/projects/${encodeURIComponent(project.publication.projectId)}?teamId=${encodeURIComponent(String(project.publication.teamId))}`,
        "--cwd",
        directory,
      ]),
    ),
  );
  const link = record(identity.link);
  if (
    identity.id !== project.publication.projectId ||
    identity.accountId !== project.publication.teamId ||
    identity.name !== project.publication.projectName ||
    link.type !== "github" ||
    `${link.org}/${link.repo}` !== project.repository ||
    link.productionBranch !== project.baseBranch ||
    identity.rootDirectory
  ) {
    throw new Error(
      "Vercel no coincide con el equipo, proyecto, repositorio, rama de producción o directorio raíz. Los monorepos necesitan un contrato específico.",
    );
  }
  if (identity.autoExposeSystemEnvs !== true) {
    throw new Error(
      "Habilita System Environment Variables en Settings → Build and Deployment de Vercel.",
    );
  }
}

/** Validate selection and list variants without creating a session or prompt. */
export async function checkModel(
  config: FactoryConfig,
  createAgent = (runtime: FactoryConfig) => new OpenCode(runtime),
) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "foundry-setup-model-")),
  );
  const projectDir = join(root, "project");
  const dataDir = join(root, "data");
  mkdirSync(projectDir);
  mkdirSync(dataDir);
  const agent = createAgent({
    ...config,
    projectDir,
    dataDir,
    managedProject: undefined,
  });
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
  };
  // The native adapter bounds startup/HTTP and owns its process group.
  // Do not send any prompt: catalog inspection has no inference charge.
  let preserve = false;
  let failure: unknown;
  const secrets: string[] = [];
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    await agent.start(
      () => {},
      (values) => secrets.push(...values),
    );
    if (interrupted) {
      throw new Error("Se canceló la consulta del catálogo del modelo.");
    }
    const efforts = await agent.availableReasoningEfforts();
    console.log(`Modelo: ${config.provider}/${config.model}`);
    console.log(`Esfuerzos: ${["default", ...efforts].join(", ")}`);
    if (
      config.reasoningEffort !== undefined &&
      !efforts.includes(config.reasoningEffort)
    ) {
      throw new Error(
        "El esfuerzo seleccionado no aparece en el catálogo del modelo.",
      );
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (agent.ownedPid) {
        const stopped = await agent.stop(null);
        preserve = !stopped.exited;
      } else if (agent.process?.pid) {
        preserve = true;
      }
    } catch (error) {
      failure = error;
      preserve = true;
    }
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    if (!preserve) {
      rmSync(root, { recursive: true, force: true });
    }
  }
  if (preserve) {
    throw new Error(
      `No se confirmó la parada de OpenCode. Inspecciona ${root}.`,
      { cause: failure },
    );
  }
  if (failure) {
    throw new Error(sanitizer(secrets)(String(failure)).text);
  }
  if (interrupted) {
    throw new Error("Se canceló la consulta del catálogo del modelo.");
  }
}

/** Use the same clone, reduced environment and verifier as a Factory run. */
export async function checkBase(
  project: ManagedProject,
  processPort: ProcessPort = execute,
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "foundry-setup-base-")));
  const abort = new AbortController();
  const interrupt = () =>
    abort.abort(new Error("Se canceló la verificación de instalación."));
  const timer = setTimeout(
    () =>
      abort.abort(
        new Error("La verificación de instalación superó los 20 minutos."),
      ),
    20 * 60 * 1000,
  );
  let preserve = false;
  const processes: typeof execute = async (command, args, options) => {
    const result = await processPort(command, args, {
      ...options,
      signal: abort.signal,
    });
    preserve ||= result.forcedStop === true;

    return result;
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    const workspace = await new GitWorkspace(root, processes).prepare(
      randomUUID(),
      { ...project, verification: { commands: [] } },
      async (id, _label, action) => {
        const labels: Record<string, string> = {
          clone: "Clonando la base del proyecto…",
          "base-context": "Comprobando identidad e instrucciones…",
          preparation: "Instalando las dependencias del proyecto…",
        };
        console.log(labels[id] ?? "Preparando el proyecto…");
        const result = await action();
        if ("code" in result && result.code !== 0) {
          console.error(result.output);
        }

        return result;
      },
    );
    for (const path of [
      ...project.instructions,
      ...(project.verification.e2e
        ? [project.verification.e2e.configFile]
        : []),
    ]) {
      const target = realpathSync(containedFile(workspace.directory, path));
      if (!target.startsWith(workspace.directory + sep)) {
        throw new Error("Un enlace de instrucciones o pruebas sale del clon.");
      }
    }
    const report = verificationPlan(
      workspace.baseSha,
      project.verification.commands,
      "Verificación de la base para la instalación",
    );
    try {
      await new CandidateVerifier(root, processes).verify(
        workspace,
        project,
        report,
        (_report, output) => {
          if (output) {
            const check = _report.checks.find(
              (check) => check.partId === output.id,
            );
            if (check) {
              console.log(
                `Verificación: ${check.command} · salida ${check.code}`,
              );
            }
            if (
              _report.checks.some(
                (check) => check.partId === output.id && check.code !== 0,
              )
            ) {
              console.error(output.text);
            }
          }
        },
        abort.signal,
      );
    } finally {
      preserve ||= report.effectsUncertain === true;
    }
    abort.signal.throwIfAborted();
    if (report.status !== "passed") {
      throw new Error(report.error ?? "La verificación de la base ha fallado.");
    }
  } finally {
    clearTimeout(timer);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    if (preserve) {
      console.error(
        `Inspecciona los procesos inciertos antes de eliminar ${root}.`,
      );
    } else {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

export async function checkPort(port: number) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("El puerto del Dashboard debe estar entre 1024 y 65535.");
  }
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}

export function requireStopped(root: string) {
  const lock = join(root, "data", "factory.lock");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    if (!Number.isSafeInteger(pid) || pid < 1) {
      throw new Error(
        "Inspecciona el lock inválido de la Factory antes de reconfigurar.",
      );
    }
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        return;
      }
      throw error;
    }
    throw new Error("Detén la Factory antes de reconfigurar.");
  }
}

export async function checkToolchain(
  directory: string,
  command: RemoteCommand = remoteCommand,
) {
  const nodeVersion = join(directory, ".node-version");
  if (existsSync(nodeVersion)) {
    const expected = readFileSync(nodeVersion, "utf8").trim().replace(/^v/, "");
    if (
      /^\d+\.\d+\.\d+$/.test(expected) &&
      process.versions.node !== expected
    ) {
      throw new Error(
        `El proyecto necesita Node ${expected}; está activo ${process.versions.node}. La Factory también debe ser compatible con esa versión.`,
      );
    }
  }
  const packagePath = join(directory, "package.json");
  if (!existsSync(packagePath)) {
    console.log(
      "Comprueba los requisitos de tus comandos antes de verificarlos.",
    );
    return;
  }
  const pkg = record(JSON.parse(readFileSync(packagePath, "utf8")));
  if (pkg.packageManager === undefined) {
    console.log(
      "El proyecto no declara una versión de gestor de paquetes. Revisa sus instrucciones.",
    );
    return;
  }
  if (typeof pkg.packageManager !== "string") {
    throw new Error("packageManager no es válido en el proyecto.");
  }
  const manager = /^(npm|pnpm|yarn)@(\d+\.\d+\.\d+)(?:\+.*)?$/.exec(
    pkg.packageManager,
  );
  if (!manager) {
    throw new Error(
      "El wizard admite npm, pnpm o yarn con una versión exacta en packageManager.",
    );
  }
  let actual: string;
  try {
    actual = (
      await command(manager[1], ["--version"], undefined, { cwd: directory })
    ).trim();
  } catch {
    throw new Error(
      `Instala ${manager[1]} ${manager[2]} en el PATH antes de continuar.`,
    );
  }
  if (actual !== manager[2]) {
    throw new Error(
      `El proyecto necesita ${manager[1]} ${manager[2]}; está activo ${actual}.`,
    );
  }
  console.log(`Gestor del proyecto comprobado: ${manager[1]} ${actual}`);
}
