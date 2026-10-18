import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";

test("la CLI rechaza una segunda instancia, conserva el trabajo incierto tras reiniciar y nunca lo vuelve a enviar", async () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-cli-"));
  const project = join(root, "project");
  mkdirSync(project);
  const config = join(root, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      dataDir: join(root, "data"),
      projectDir: project,
      provider: "openai",
      model: "gpt-6-luna",
      auth: "opencode",
      opencodeCli: "/nonexistent/opencode-auth-test",
    }),
  );
  const env = { PATH: process.env.PATH, HOME: root, TMPDIR: tmpdir() };
  const launch = (...args: string[]) =>
    spawn(
      process.execPath,
      [resolve("src/cli.ts"), ...args, "--config", config],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
  const ready = (child: ChildProcess) =>
    new Promise<string>((resolve, reject) => {
      let output = "";
      child.stdout!.on("data", (chunk) => {
        output += String(chunk);
        const match = output.match(
          /Factory panel: (http:\/\/127\.0\.0\.1:\d+)/,
        );
        if (match) {
          resolve(match[1]);
        }
      });
      child.once("exit", () =>
        reject(new Error("Factory exited before readiness")),
      );
      child.once("error", reject);
    });
  let child = launch("serve", "--port", "0");
  try {
    const origin = await ready(child);
    const second = launch("serve", "--port", "0");
    assert.notEqual((await once(second, "exit"))[0], 0);
    const task = join(root, "task.txt");
    writeFileSync(task, "Never sent: no credential in the test environment");
    const admission = launch("run", "--task-file", task);
    await once(admission, "exit");
    const snapshot = await fetch(`${origin}/api/view`).then((r) => r.json());
    assert.equal(snapshot.run.status, "intervention");
    assert.match(snapshot.run.error, /OAuth export unavailable/);
    const id = snapshot.run.id;
    const exit = once(child, "exit");
    child.kill("SIGTERM");
    await exit;
    child = launch("serve", "--port", "0");
    const restarted = await ready(child);
    const recovered = await fetch(`${restarted}/api/view`).then((r) =>
      r.json(),
    );
    assert.equal(recovered.run.id, id);
    assert.match(recovered.run.error, /no task was resent/);
    assert.equal(recovered.runs.length, 1);
  } finally {
    const exit = once(child, "exit");
    child.kill("SIGTERM");
    await exit;
  }
});

test("la configuración documentada del Managed project inicia el Workflow sin un clon previo", async (t) => {
  for (const location of ["separate", "inside trusted directory"]) {
    await t.test(
      location === "separate"
        ? "fuera del directorio de confianza"
        : "dentro del directorio de confianza",
      async () => {
        const root = mkdtempSync(join(tmpdir(), "foundry-config-start-"));
        const trusted = join(root, "trusted");
        const bin = join(root, "bin");
        mkdirSync(trusted);
        mkdirSync(bin);
        const repository = `team/config-${root.split("-").at(-1)}`;
        const project = JSON.parse(
          readFileSync("config/managed-projects/rebobina.json", "utf8"),
        );
        project.repository = repository;
        writeFileSync(join(trusted, "project.json"), JSON.stringify(project));
        const config = JSON.parse(
          readFileSync("config/factory.example.json", "utf8"),
        );
        config.dataDir = join(location === "separate" ? root : trusted, "data");
        config.managedProjectFile = "project.json";
        const configPath = join(trusted, "factory.json");
        writeFileSync(configPath, JSON.stringify(config));
        // Control only the external GitHub process. Startup, SQLite and HTTP are real.
        writeFileSync(
          join(bin, "gh"),
          `#!${process.execPath}
process.stdout.write("[[]]");
`,
          { mode: 0o700 },
        );
        const child = spawn(
          process.execPath,
          [
            resolve("src/cli.ts"),
            "serve",
            "--config",
            configPath,
            "--port",
            "0",
          ],
          {
            env: {
              PATH: `${bin}:${process.env.PATH}`,
              HOME: root,
              TMPDIR: tmpdir(),
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        const exited = once(child, "exit");
        let stderr = "";
        child.stderr!.on("data", (chunk) => {
          stderr += String(chunk);
        });
        try {
          const origin = await new Promise<string>((resolve, reject) => {
            let output = "";
            child.stdout!.on("data", (chunk) => {
              output += String(chunk);
              const match = output.match(
                /Factory panel: (http:\/\/127\.0\.0\.1:\d+)/,
              );
              if (match) {
                resolve(match[1]);
              }
            });
            child.once("error", reject);
            child.once("exit", () =>
              reject(new Error(`Configured Workflow did not start: ${stderr}`)),
            );
          });
          const response = await fetch(`${origin}/api/view`);
          assert.equal(response.status, 200);
          const snapshot = await response.json();
          assert.equal(
            snapshot.source,
            `https://github.com/${repository}/issues`,
          );
          assert.deepEqual(snapshot.runs, []);
          assert.equal(snapshot.fault, null);
        } finally {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGTERM");
          }
          await exited;
        }
      },
    );
  }
});

test("los clones candidatos no pueden aportar la configuración de Factory ni la del Managed project", async (t) => {
  for (const location of [
    "Factory file in explicit clone",
    "Managed project file in explicit clone",
    "symlink into owned clone",
  ]) {
    await t.test(
      (
        {
          "Factory file in explicit clone":
            "archivo de Factory en un clon explícito",
          "Managed project file in explicit clone":
            "archivo de Managed project en un clon explícito",
          "symlink into owned clone": "enlace simbólico al clon propio",
        } as const
      )[location],
      () => {
        const root = mkdtempSync(join(tmpdir(), "foundry-untrusted-config-"));
        const trusted = join(root, "trusted");
        const candidate = join(root, "candidate");
        const dataDir = join(root, "data");
        mkdirSync(trusted);
        mkdirSync(candidate);
        const ownedClone = join(dataDir, "workspaces", "candidate");
        mkdirSync(ownedClone, { recursive: true });
        const config = JSON.parse(
          readFileSync("config/factory.example.json", "utf8"),
        );
        config.dataDir = dataDir;
        const configPath = join(
          location === "Factory file in explicit clone" ? candidate : trusted,
          "factory.json",
        );
        const projectPath = join(
          location === "Managed project file in explicit clone"
            ? candidate
            : location === "symlink into owned clone"
              ? ownedClone
              : trusted,
          "project.json",
        );
        writeFileSync(
          projectPath,
          readFileSync("config/managed-projects/rebobina.json"),
        );
        if (location === "symlink into owned clone") {
          const link = join(trusted, "project.json");
          symlinkSync(projectPath, link);
          config.managedProjectFile = link;
        } else {
          config.projectDir = candidate;
          config.managedProjectFile = projectPath;
        }
        writeFileSync(configPath, JSON.stringify(config));
        const result = spawnSync(
          process.execPath,
          [
            resolve("src/cli.ts"),
            "serve",
            "--config",
            configPath,
            "--port",
            "0",
          ],
          {
            env: { HOME: root, PATH: "", TMPDIR: tmpdir() },
            encoding: "utf8",
            timeout: 5000,
          },
        );
        assert.equal(result.error, undefined);
        assert.notEqual(result.status, 0);
        assert.match(
          result.stderr,
          /Trusted configuration must be outside candidate clones/,
        );
      },
    );
  }
});
