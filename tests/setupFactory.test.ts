import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  statSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {
  setupProject,
  setupConfig,
  readAnswers,
  launcher,
  writeSetupFile,
  projectDefaults,
} from "../scripts/setup/configuration.ts";
import {
  checkGithub,
  checkProtection,
  checkVercel,
  checkPort,
  requireStopped,
  checkBase,
  checkToolchain,
  checkModel,
} from "../scripts/setup/checks.ts";
import { OpenCode } from "../src/infrastructure/opencode/agent.ts";
import { execute, type ProcessPort } from "../src/infrastructure/process.ts";
import { main } from "../scripts/setupFactory.ts";
import { readConfig } from "../src/infrastructure/configuration.ts";

const answers = {
  REPOSITORY: "team/product",
  BASE_BRANCH: "main",
  INSTRUCTIONS: "AGENTS.md|README.md",
  INSTALL_COMMAND: "npm ci",
  CHECK_COMMANDS: "npm run build|npm run test:e2e",
  E2E_ENABLED: "si",
  E2E_COMMAND: "npm run test:e2e",
  E2E_CONFIG: "playwright.config.ts",
  E2E_SERVER: "python3 -m http.server 4173 --bind 127.0.0.1 --directory dist",
  E2E_ORIGIN: "http://127.0.0.1:4173",
  BUILD_DIRECTORY: "dist",
  VERCEL_PROJECT_ID: "prj_example",
  VERCEL_TEAM_ID: "team_example",
  VERCEL_PROJECT: "product",
  VERSION_PATH: "/version.json",
  PROVIDER: "anthropic",
  MODEL: "claude-example",
  REASONING_EFFORT: "high",
  OPENCODE_CLI: "/opt/homebrew/bin/opencode",
  VERCEL_CLI: "/opt/homebrew/bin/vercel",
  INPUT_PRICE: "1.25",
  OUTPUT_PRICE: "8",
  CACHE_PRICE: "0",
};

const root = () =>
  realpathSync(mkdtempSync(join(tmpdir(), "foundry setup ' $(literal)-")));
const dotenv = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([key, value]) => `${key}='${value.replaceAll("'", "'\\''")}'\n`)
    .join("");

test("el wizard guarda la selección y las tarifas con el contrato real de la Factory", () => {
  const directory = root();
  try {
    writeSetupFile(
      join(directory, "managed-project.json"),
      JSON.stringify(setupProject(answers)),
    );
    writeSetupFile(
      join(directory, "factory.local.json"),
      JSON.stringify(setupConfig(answers, directory)),
    );
    const config = readConfig(join(directory, "factory.local.json"));
    assert.equal(config.managedProject?.repository, "team/product");
    assert.equal(config.reasoningEffort, "high");
    assert.equal(config.provider, "anthropic");
    assert.equal(config.model, "claude-example");
    assert.deepEqual(config.tokenPrices, {
      inputUsdPerMillion: 1.25,
      outputUsdPerMillion: 8,
      cacheReadUsdPerMillion: 0,
    });
    assert.equal(
      statSync(join(directory, "factory.local.json")).mode & 0o777,
      0o600,
    );
    const local = setupConfig(
      { ...answers, PROVIDER: "ollama", REASONING_EFFORT: "default" },
      directory,
    );
    assert.equal("opencodeCli" in local, false);
    assert.equal("reasoningEffort" in local, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("el wizard rechaza tarifas ausentes, negativas, no finitas y formatos ambiguos", () => {
  for (const price of [
    "",
    "-1",
    "NaN",
    "Infinity",
    "1,5",
    "0x10",
    "9".repeat(400),
  ]) {
    assert.throws(() =>
      setupConfig({ ...answers, INPUT_PRICE: price }, "/tmp"),
    );
  }
  assert.throws(() => setupProject({ ...answers, E2E_ENABLED: "no" }));
  assert.throws(() =>
    setupProject({ ...answers, INSTRUCTIONS: "../README.md" }),
  );
  assert.throws(() =>
    setupProject({ ...answers, E2E_ORIGIN: "http://localhost:4173" }),
  );
});

test("las respuestas se leen como datos y conservan comillas, espacios y sintaxis shell literal", () => {
  const directory = root();
  try {
    const file = join(directory, ".setup.env");
    const literal = "nombre ' con $(touch SHOULD_NOT_EXIST) y `comando`";
    writeFileSync(file, dotenv({ PUBLIC_VALUE: literal }));
    assert.equal(readAnswers(file).PUBLIC_VALUE, literal);
    writeFileSync(file, "KEY='ok'\ntouch SHOULD_NOT_EXIST\n");
    assert.throws(() => readAnswers(file));
    assert.equal(existsSync(join(directory, "SHOULD_NOT_EXIST")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("la biblioteca Bash de macOS guarda respuestas literales y confirma con s en español", () => {
  const directory = root();
  try {
    const script = readFileSync(
      new URL("../scripts/setup-factory.sh", import.meta.url),
      "utf8",
    );
    const library = script.split('run_wizard "$@"; exit')[0];
    const value = "Ruta ' con $(literal) y `literal`";
    const file = join(directory, ".setup.env");
    const result = spawnSync(
      "/bin/bash",
      [
        "-c",
        library +
          `
      write_env PUBLIC_VALUE "$LITERAL_VALUE"
      confirm "¿Continuar?"
      finish
    `,
      ],
      {
        input: "s\n",
        encoding: "utf8",
        env: { ...process.env, ENV_FILE: file, LITERAL_VALUE: value },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Configuración completada/);
    assert.equal(readAnswers(file).PUBLIC_VALUE, value);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("una reconfiguración usa el entrypoint de este wizard y no el de la instalación anterior", () => {
  const directory = root();
  try {
    const source = join(directory, "source");
    const factory = join(directory, "factory");
    mkdirSync(join(source, "scripts", "setup"), { recursive: true });
    mkdirSync(join(factory, "scripts", "setup"), { recursive: true });
    writeFileSync(join(source, "scripts", "setupFactory.ts"), "nuevo\n");
    writeFileSync(join(source, "scripts", "testOpenCode.ts"), "nuevo-probe\n");
    writeFileSync(
      join(source, "scripts", "setup", "checks.ts"),
      "nuevo-checks\n",
    );
    writeFileSync(join(factory, "scripts", "setupFactory.ts"), "viejo\n");
    writeFileSync(join(factory, "scripts", "testOpenCode.ts"), "viejo-probe\n");
    writeFileSync(
      join(factory, "scripts", "setup", "checks.ts"),
      "viejo-checks\n",
    );
    writeFileSync(join(factory, "scripts", "setup", "obsoleto.ts"), "borrar\n");
    const script = readFileSync(
      new URL("../scripts/setup-factory.sh", import.meta.url),
      "utf8",
    );
    const start = script.indexOf("align_setup_entrypoint() {");
    assert.notEqual(start, -1);
    let depth = 0;
    let end = -1;
    for (
      let index = script.indexOf("{", start);
      index < script.length;
      index++
    ) {
      const char = script[index];
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    assert.notEqual(end, -1);
    const call = script.indexOf("\n  align_setup_entrypoint\n");
    const stopped = script.indexOf("\n  setup stopped ");
    assert.ok(call !== -1 && call < stopped);
    const run = (sourceRoot: string, factoryDir: string) =>
      spawnSync(
        "/bin/bash",
        [
          "-c",
          "set -euo pipefail\n" +
            script.slice(start, end + 1) +
            "\nalign_setup_entrypoint\n",
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            SOURCE_ROOT: sourceRoot,
            FACTORY_DIR: factoryDir,
          },
        },
      );
    const same = run(factory, factory);
    assert.equal(same.status, 0, same.stderr);
    assert.equal(
      readFileSync(join(factory, "scripts", "setupFactory.ts"), "utf8"),
      "viejo\n",
    );
    const updated = run(source, factory);
    assert.equal(updated.status, 0, updated.stderr);
    assert.equal(
      readFileSync(join(factory, "scripts", "setupFactory.ts"), "utf8"),
      "nuevo\n",
    );
    assert.equal(
      readFileSync(join(factory, "scripts", "testOpenCode.ts"), "utf8"),
      "nuevo-probe\n",
    );
    assert.equal(
      readFileSync(join(factory, "scripts", "setup", "checks.ts"), "utf8"),
      "nuevo-checks\n",
    );
    assert.equal(
      existsSync(join(factory, "scripts", "setup", "obsoleto.ts")),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("el lanzador funciona desde otro directorio y no ejecuta metacaracteres en las rutas", () => {
  const directory = root();
  try {
    const factory = join(directory, "factory");
    mkdirSync(factory);
    const capture = join(directory, "arguments.json");
    const node = join(directory, "node ' $(literal)");
    writeFileSync(
      node,
      `#!/bin/bash\nexec ${process.execPath} -e 'require("fs").writeFileSync(process.env.CAPTURE, JSON.stringify({ args: process.argv.slice(1), cwd: process.cwd() }))' -- "$@"\n`,
      { mode: 0o700 },
    );
    const script = join(directory, "start-factory.sh");
    writeSetupFile(
      script,
      launcher(directory, node, "/usr/bin:/bin", "4310"),
      0o700,
    );
    const result = spawnSync("/bin/bash", [script], {
      cwd: "/tmp",
      encoding: "utf8",
      env: { ...process.env, CAPTURE: capture },
    });
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(readFileSync(capture, "utf8"));
    assert.equal(actual.cwd, factory);
    assert.deepEqual(actual.args, [
      "--experimental-strip-types",
      "src/cli.ts",
      "serve",
      "--config",
      join(directory, "factory.local.json"),
      "--port",
      "4310",
    ]);
    assert.throws(() => launcher(directory, node, "PATH", "4310; touch BAD"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("las escrituras rechazan enlaces simbólicos sin modificar su destino", () => {
  const directory = root();
  try {
    const original = join(directory, "original");
    writeFileSync(original, "keep");
    const link = join(directory, "link");
    symlinkSync(original, link);
    assert.throws(() => writeSetupFile(link, "replace"));
    assert.equal(readFileSync(original, "utf8"), "keep");
    symlinkSync(join(directory, "missing"), join(directory, "dangling"));
    assert.throws(() => writeSetupFile(join(directory, "dangling"), "replace"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("OpenCode local reconoce su binario cuando la instalación contiene espacios", () => {
  const directory = root();
  try {
    const checkout = join(directory, "Factory with spaces");
    symlinkSync(
      fileURLToPath(new URL("../", import.meta.url)),
      checkout,
      "dir",
    );
    const result = spawnSync(
      process.execPath,
      [
        "--preserve-symlinks",
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        `
        import { pathToFileURL } from "node:url";
        const { OpenCode } = await import(pathToFileURL(
          process.argv[1] + "/src/infrastructure/opencode/agent.ts"));
        const agent = new OpenCode({
          dataDir: process.argv[2], projectDir: process.argv[2],
          provider: "openai", model: "example", auth: "opencode",
          opencodeCli: "/usr/bin/false",
        });
        try {
          await agent.start(() => {});
          process.exitCode = 1;
        } catch (error) {
          console.log(error.message);
          if (!error.message.includes("credential export unavailable")) {
            process.exitCode = 1;
          }
        }
      `,
        checkout,
        directory,
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /credential export unavailable/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "el catálogo usa OpenCode real sin prompts, limpia el proceso y sanea errores con credenciales ficticias",
  { timeout: 30_000 },
  async () => {
    const directory = root();
    const access = "fictional-wizard-oauth-access";
    const refresh = "fictional-wizard-oauth-refresh";
    try {
      const exporter = join(directory, "exporter");
      const credentials = [
        {
          active: true,
          integrationID: "openai",
          value: {
            type: "oauth",
            methodID: "oauth",
            access,
            refresh,
            expires: Date.now() + 3_600_000,
          },
        },
      ];
      writeFileSync(
        exporter,
        `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(credentials))});\n`,
        { mode: 0o700 },
      );
      for (const fail of [false, true]) {
        let temporary = "";
        const check = checkModel(
          {
            dataDir: directory,
            projectDir: directory,
            provider: "openai",
            model: "gpt-6-luna",
            reasoningEffort: "low",
            auth: "opencode",
            opencodeCli: exporter,
          },
          (config) => {
            temporary = config.dataDir;
            const agent = new OpenCode(config);
            agent.create = async () =>
              assert.fail("No session should be created");
            agent.send = async () => assert.fail("No prompt should be sent");
            if (fail) {
              agent.availableReasoningEfforts = async () => {
                throw new Error(`Provider error: ${access} ${refresh}`);
              };
            }

            return agent;
          },
        );
        if (fail) {
          await assert.rejects(check, (error: Error) => {
            assert.doesNotMatch(error.message, /fictional-wizard-oauth/);

            return true;
          });
        } else {
          await check;
        }
        assert.equal(existsSync(temporary), false);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("las propuestas proceden de scripts reales del proyecto sin ejecutar sus instrucciones", () => {
  const directory = root();
  try {
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@12.14.0",
        scripts: {
          build: "astro build",
          lint: "eslint .",
          "test:e2e": "playwright test",
        },
      }),
    );
    writeFileSync(join(directory, "README.md"), "Instructions");
    writeFileSync(
      join(directory, "playwright.config.mjs"),
      "throw new Error()",
    );
    const proposed = projectDefaults(directory);
    assert.equal(
      proposed.CHECK_COMMANDS,
      "pnpm run build|pnpm run lint|pnpm run test:e2e",
    );
    assert.equal(proposed.E2E_CONFIG, "playwright.config.mjs");
    assert.equal(proposed.INSTRUCTIONS, "README.md");
    assert.equal(proposed.E2E_ENABLED, "si");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("la versión del gestor del producto debe coincidir y no se ejecutan nombres arbitrarios", async () => {
  const directory = root();
  try {
    const file = join(directory, "package.json");
    writeFileSync(file, JSON.stringify({ packageManager: "pnpm@12.14.0" }));
    await checkToolchain(directory, async (executable, args) => {
      assert.equal(executable, "pnpm");
      assert.deepEqual(args, ["--version"]);

      return "12.14.0\n";
    });
    await assert.rejects(
      checkToolchain(directory, async () => "10.0.0"),
      /necesita pnpm 12.14.0/,
    );
    writeFileSync(
      file,
      JSON.stringify({ packageManager: "shell-command@1.0.0" }),
    );
    await assert.rejects(
      checkToolchain(directory, async () =>
        assert.fail("No command should run"),
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("GitHub debe permitir escritura e issues y Vercel debe corresponder al repositorio seleccionado", async () => {
  const project = setupProject(answers);
  for (const push of [true, false]) {
    const check = checkGithub(project, async (_exe, args) =>
      args[1].endsWith("/main")
        ? "{}"
        : JSON.stringify({
            full_name: project.repository,
            permissions: { push },
            has_issues: true,
            archived: false,
          }),
    );
    if (push) {
      await check;
    } else {
      await assert.rejects(check, /escritura/);
    }
  }
  const identity = {
    id: "prj_example",
    accountId: "team_example",
    name: "product",
    autoExposeSystemEnvs: true,
    rootDirectory: null,
    link: {
      type: "github",
      org: "team",
      repo: "product",
      productionBranch: "main",
    },
  };
  await checkVercel(project, "vercel", "/tmp", async () =>
    JSON.stringify(identity),
  );
  for (const overrides of [
    { accountId: "team_other" },
    { rootDirectory: "app" },
    { autoExposeSystemEnvs: false },
    { link: { ...identity.link, repo: "other" } },
  ]) {
    await assert.rejects(
      checkVercel(project, "vercel", "/tmp", async () =>
        JSON.stringify({ ...identity, ...overrides }),
      ),
    );
  }
  await checkProtection(project, async () =>
    JSON.stringify({
      required_pull_request_reviews: {},
      enforce_admins: { enabled: true },
      required_status_checks: {
        strict: true,
        contexts: ["Vercel", "Factory / ready-to-merge"],
      },
    }),
  );
  await assert.rejects(
    checkProtection(project, async () =>
      JSON.stringify({
        required_pull_request_reviews: {},
        enforce_admins: { enabled: true },
        required_status_checks: { strict: false, contexts: ["Vercel"] },
      }),
    ),
  );
});

test("la comprobación remota no necesita Preview y conserva las validaciones de configuración", () => {
  const directory = root();
  try {
    const cli = join(directory, "gh");
    const log = join(directory, "calls.jsonl");
    writeFileSync(
      cli,
      `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CLI_LOG, JSON.stringify(args) + "\\n");
const responses = {
  "repos/team/product": {
    full_name: "team/product", permissions: { push: true },
    has_issues: true, archived: false,
  },
  "repos/team/product/branches/main": {},
  "repos/team/product/branches/main/protection": {
    required_pull_request_reviews: {}, enforce_admins: { enabled: true },
    required_status_checks: {
      strict: true, contexts: ["Vercel", "Factory / ready-to-merge"],
    },
  },
  "/v9/projects/prj_example?teamId=team_example": {
    id: "prj_example", accountId: "team_example", name: "product",
    autoExposeSystemEnvs: true, rootDirectory: null,
    link: { type: "github", org: "team", repo: "product", productionBranch: "main" },
  },
};
if (args[0] !== "api" || !Object.hasOwn(responses, args[1])) {
  throw new Error("Unexpected external operation: " + JSON.stringify(args));
}
console.log(JSON.stringify(responses[args[1]]));
`,
      { mode: 0o700 },
    );
    const path = join(directory, ".setup.env");
    for (const legacy of [false, true]) {
      writeFileSync(log, "");
      writeFileSync(
        path,
        dotenv({
          ...answers,
          VERCEL_CLI: cli,
          ...(legacy ? { PREVIEW_URL: "legacy-value-no-longer-used" } : {}),
        }),
      );
      const result = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          fileURLToPath(new URL("../scripts/setupFactory.ts", import.meta.url)),
          "remote",
          path,
        ],
        {
          encoding: "utf8",
          timeout: 15_000,
          env: {
            ...process.env,
            PATH: directory + ":" + process.env.PATH,
            CLI_LOG: log,
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        calls.map((args) => args[1]),
        [
          "repos/team/product",
          "repos/team/product/branches/main",
          "/v9/projects/prj_example?teamId=team_example",
          "repos/team/product/branches/main/protection",
        ],
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("un puerto ocupado se rechaza y una Factory activa bloquea la reconfiguración", async () => {
  const directory = root();
  const server = createServer();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(checkPort(address.port));
    assert.equal(server.listening, true);
    mkdirSync(join(directory, "data"));
    writeFileSync(join(directory, "data", "factory.lock"), String(process.pid));
    assert.throws(() => requireStopped(directory), /Detén/);
  } finally {
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("la comprobación de base instala y verifica un clon real con el entorno de la Factory", async () => {
  const directory = root();
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);

    return result.stdout;
  };
  try {
    git("init", "-b", "main");
    writeFileSync(join(directory, "README.md"), "Trusted instructions");
    writeFileSync(join(directory, ".gitignore"), "setup-ok\n");
    git("add", ".");
    git(
      "-c",
      "user.name=Setup test",
      "-c",
      "user.email=setup@example.com",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "Fixture",
    );
    const processes: ProcessPort = async (command, args, options) => {
      if (args.includes("clone")) {
        const rewritten = args.map((argument) =>
          argument === "https://github.com/team/product.git"
            ? directory
            : argument,
        );
        const result = await execute(command, rewritten, options);
        if (result.code === 0) {
          const remote = await execute(
            "git",
            [
              "remote",
              "set-url",
              "origin",
              "https://github.com/team/product.git",
            ],
            { ...options, cwd: args.at(-1)! },
          );
          assert.equal(remote.code, 0);
        }

        return result;
      }

      return execute(command, args, options);
    };
    const project = setupProject({
      ...answers,
      E2E_ENABLED: "no",
      INSTRUCTIONS: "README.md",
      CHECK_COMMANDS: "node --version",
    });
    project.preparation.command = `node -e 'require("fs").writeFileSync("setup-ok", "ok")'`;
    project.verification.commands = [
      `node -e 'if (require("fs").readFileSync("setup-ok", "utf8") !== "ok") process.exit(2)'`,
    ];
    await checkBase(project, processes);
    assert.equal(existsSync(join(directory, "setup-ok")), false);
    project.verification.commands = ["node -e 'process.exit(3)'"];
    await assert.rejects(
      checkBase(project, processes),
      /Falló la verificación/,
    );
    assert.equal(git("status", "--porcelain"), "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("la configuración provisional no altera la instalada y finalizar conserva copias anteriores", async () => {
  const directory = root();
  try {
    const file = join(directory, ".setup.env");
    const values = { ...answers, PORT: "65431" };
    writeFileSync(file, dotenv(values));
    await main(["project", file]);
    await main(["config", file]);
    assert.equal(existsSync(join(directory, "start-factory.sh")), false);
    writeFileSync(join(directory, "factory.local.json"), "old configuration");
    await main(["finalize", file]);
    assert.equal(
      readFileSync(join(directory, "factory.local.json.previous"), "utf8"),
      "old configuration",
    );
    assert.equal(
      readConfig(join(directory, "factory.local.json")).model,
      values.MODEL,
    );
    assert.equal(
      statSync(join(directory, "start-factory.sh")).mode & 0o777,
      0o700,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
