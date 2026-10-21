import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readConfig } from "../src/infrastructure/configuration.ts";
import { configureMergeProtection } from "../src/infrastructure/mergeProtection.ts";
import { sanitizer } from "../src/application/sanitize.ts";
import { probeOpenCode } from "./testOpenCode.ts";
import { exportCredential } from "../src/infrastructure/opencode/credentials.ts";
import {
  readAnswers,
  projectDefaults,
  setupConfig,
  setupProject,
  launcher,
  writeSetupFile,
} from "./setup/configuration.ts";
import {
  checkBase,
  checkGithub,
  checkModel,
  checkPort,
  checkProtection,
  checkVercel,
  requireStopped,
  checkToolchain,
} from "./setup/checks.ts";

export async function main(args: string[]) {
  const [command, answersPath, argument] = args;
  if (!answersPath) {
    throw new Error(
      "Uso: setupFactory.ts COMANDO ARCHIVO_RESPUESTAS [ARGUMENTO]",
    );
  }
  const root = dirname(resolve(answersPath));
  const values = readAnswers(answersPath);
  const pending = join(root, ".setup-config");
  const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
  if (command === "suggest") {
    console.log(projectDefaults(argument)[args[3]] ?? "");
    return;
  }
  if (command === "stopped") {
    requireStopped(root);
    return;
  }
  if (command === "toolchain") {
    await checkToolchain(argument);
    return;
  }
  if (command === "auth") {
    // Do not print exported credentials or store them in setup files.
    exportCredential(values.OPENCODE_CLI, values.PROVIDER, () => {});
    return;
  }
  if (command === "github") {
    await checkGithub({
      repository: values.REPOSITORY,
      baseBranch: values.BASE_BRANCH,
    });
    return;
  }
  if (command === "project") {
    mkdirSync(pending, { recursive: true, mode: 0o700 });
    writeSetupFile(
      join(pending, "managed-project.json"),
      json(setupProject(values)),
    );
    return;
  }
  const project = setupProject(values);
  if (command === "vercel") {
    await checkVercel(project, values.VERCEL_CLI, root);
  } else if (command === "protect") {
    await configureMergeProtection(project);
    await checkProtection(project);
  } else if (command === "remote") {
    await checkGithub(project);
    await checkVercel(project, values.VERCEL_CLI, root);
    await checkProtection(project);
  } else if (command === "config") {
    writeSetupFile(
      join(pending, "factory.local.json"),
      json(setupConfig(values, root)),
    );
    readConfig(join(pending, "factory.local.json"));
  } else if (command === "model" || command === "catalog") {
    const config = readConfig(join(pending, "factory.local.json"));
    await checkModel(
      command === "catalog"
        ? { ...config, reasoningEffort: undefined }
        : config,
    );
  } else if (command === "probe") {
    const config = readConfig(join(pending, "factory.local.json"));
    const result = await probeOpenCode(
      config,
      "Responde OK sin usar herramientas ni hacer preguntas.",
    );
    console.log(`Duración: ${result.durationMs} ms`);
    if (!result.ok) {
      throw new Error(`La prueba del modelo ha fallado: ${result.error}`);
    }
    console.log(`Respuesta: ${result.response}`);
    console.log("Resultado: CORRECTO");
  } else if (command === "base") {
    await checkBase(project);
  } else if (command === "finalize") {
    requireStopped(root);
    await checkPort(Number(values.PORT));
    // Back up a previous valid configuration; partial setup never overwrites it.
    for (const name of [
      "factory.local.json",
      "managed-project.json",
      "start-factory.sh",
    ]) {
      const path = join(root, name);
      if (existsSync(path)) {
        writeSetupFile(path + ".previous", readFileSync(path, "utf8"));
      }
    }
    writeSetupFile(join(root, "managed-project.json"), json(project));
    writeSetupFile(
      join(root, "factory.local.json"),
      json(setupConfig(values, root)),
    );
    writeSetupFile(
      join(root, "start-factory.sh"),
      launcher(root, process.execPath, process.env.PATH ?? "", values.PORT),
      0o700,
    );
    console.log(`Arranque: ${join(root, "start-factory.sh")}`);
  } else {
    throw new Error(`Comando de instalación desconocido: ${command}`);
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    const secrets = Object.entries(process.env)
      .filter(([key]) => /TOKEN|KEY|SECRET|PASSWORD/.test(key))
      .map(([, value]) => value!)
      .filter(Boolean);
    console.error(sanitizer(secrets)(String(error)).text);
    process.exitCode = 1;
  }
}
