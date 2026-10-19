import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { setImmediate as flush } from "node:timers/promises";
import type { AgentPort, Fact } from "../src/application/agent.ts";
import type { FactoryConfig } from "../src/application/configuration.ts";
import { main, probeOpenCode } from "../scripts/testOpenCode.ts";

const config: FactoryConfig = {
  provider: "google",
  model: "configured-model",
  auth: "opencode",
  opencodeCli: "/trusted/opencode",
  dataDir: "/unused/factory-data",
  projectDir: "/unused/managed-project",
  conversationId: "must-not-resume",
  managedProject: {
    id: "smoke-project",
    repository: "team/smoke-project",
    baseBranch: "main",
    instructions: ["AGENTS.md"],
    preparation: { command: "npm install" },
    verification: { commands: ["npm test"] },
    publication: {
      provider: "vercel",
      projectId: "smoke-project",
      humanMergeRequired: true,
    },
  },
};

function completed(
  text = "OK",
  provider = config.provider,
  model = config.model,
): Fact[] {
  return [
    {
      type: "usage",
      usage: {
        id: "answer",
        provider,
        model,
        completed: true,
        tokens: null,
        sdkCost: null,
      },
    },
    { type: "finished", messageId: "answer", text },
  ];
}

function fixture(facts: Fact[] = completed()) {
  let emit: (fact: Fact) => void = () => {};
  let runtime: FactoryConfig;
  const sent: string[] = [];
  const stopped: (string | null)[] = [];
  const secret = "fictional-credential-value";
  const agent: AgentPort = {
    async start(receive, protect) {
      emit = receive;
      protect?.([secret]);
      emit({ type: "process-started", pid: 123 });
      return { pid: 123, version: "test", configuration: {} };
    },
    async create() {
      return "session";
    },
    async resume() {
      assert.fail("The probe must not resume conversations");
    },
    async send(id, prompt) {
      assert.equal(id, "session");
      sent.push(prompt);
      for (const fact of facts) {
        emit(fact);
      }
    },
    async stop(id) {
      stopped.push(id);
      assert.ok(existsSync(runtime.projectDir));
      return { exited: true, detail: "Stopped" };
    },
  };

  return {
    agent,
    secret,
    sent,
    stopped,
    runtime: () => runtime,
    createAgent(selected: FactoryConfig) {
      runtime = selected;
      return agent;
    },
  };
}

test("prueba solo la selección configurada en un directorio vacío y elimina el runtime tras cerrar", async () => {
  const fake = fixture(completed("A nonliteral answer"));
  const result = await probeOpenCode(config, "Custom prompt", (selected) => {
    assert.equal(selected.provider, config.provider);
    assert.equal(selected.model, config.model);
    assert.equal(selected.opencodeCli, config.opencodeCli);
    assert.equal(selected.conversationId, undefined);
    assert.equal(selected.managedProject, undefined);
    assert.notEqual(selected.projectDir, config.projectDir);
    assert.notEqual(selected.dataDir, config.dataDir);
    assert.deepEqual(readdirSync(selected.projectDir), []);
    writeFileSync(join(selected.dataDir, "private-runtime"), fake.secret);
    return fake.createAgent(selected);
  });
  assert.equal(result.ok, true);
  assert.equal(result.response, "A nonliteral answer");
  assert.ok(result.durationMs >= 0);
  assert.deepEqual(fake.sent, ["Custom prompt"]);
  assert.deepEqual(fake.stopped, ["session"]);
  assert.equal(existsSync(dirname(fake.runtime().dataDir)), false);
});

const failures: [string, Fact[], RegExp][] = [
  ["provider distinto", completed("OK", "anthropic"), /differs/],
  ["modelo distinto", completed("OK", config.provider, "other"), /differs/],
  ["respuesta vacía", completed(" \n"), /empty final response/],
  [
    "identidad ausente",
    [{ type: "finished", messageId: "unknown", text: "OK" }],
    /could not be verified/,
  ],
  [
    "identidad de otro mensaje",
    [completed()[0], { type: "finished", messageId: "other", text: "OK" }],
    /could not be verified/,
  ],
  [
    "error del provider",
    [{ type: "error", text: "Quota exhausted" }],
    /Quota exhausted/,
  ],
  [
    "permiso pendiente",
    [
      {
        type: "pending",
        pending: [{ id: "p", kind: "permission", text: "Allow?" }],
      },
    ],
    /human intervention/,
  ],
  [
    "pregunta pendiente",
    [
      {
        type: "pending",
        pending: [{ id: "q", kind: "question", text: "Which?" }],
      },
    ],
    /human intervention/,
  ],
  [
    "observación incompleta",
    [{ type: "gap", text: "Observation lost" }],
    /Observation lost/,
  ],
  [
    "proceso terminado",
    [{ type: "process-exit", detail: "Server exited" }],
    /Server exited/,
  ],
];

for (const [name, facts, expected] of failures) {
  test(`rechaza ${name}, sin reenviar el prompt y con limpieza`, async () => {
    const fake = fixture(facts);
    const result = await probeOpenCode(config, "Probe", fake.createAgent);
    assert.equal(result.ok, false);
    assert.match(result.error, expected);
    assert.equal(result.response, "");
    assert.equal(fake.sent.length, 1);
    assert.deepEqual(fake.stopped, ["session"]);
    assert.equal(existsSync(dirname(fake.runtime().dataDir)), false);
  });
}

test("sanea tanto respuestas como errores con las credenciales importadas", async () => {
  for (const kind of ["response", "error"]) {
    const secret = "fictional-credential-value";
    const facts: Fact[] =
      kind === "response"
        ? completed(secret)
        : [{ type: "error", text: `Failure ${secret}` }];
    const protectedFake = fixture(facts);
    const result = await probeOpenCode(
      config,
      "Probe",
      protectedFake.createAgent,
    );
    const output = JSON.stringify(result);
    assert.doesNotMatch(output, new RegExp(protectedFake.secret));
    assert.match(output, /REDACTED/);
  }
});

test("un arranque parcial fallido cierra el proceso sin crear sesión ni enviar prompts", async () => {
  const fake = fixture();
  fake.agent.start = async (emit, protect) => {
    protect?.([fake.secret]);
    emit({ type: "process-started", pid: 123 });
    throw new Error(`Startup failed ${fake.secret}`);
  };
  fake.agent.create = async () => assert.fail("Must not create a session");
  const result = await probeOpenCode(config, "Probe", fake.createAgent);
  assert.equal(result.ok, false);
  assert.match(result.error, /Startup failed \[REDACTED\]/);
  assert.deepEqual(fake.sent, []);
  assert.deepEqual(fake.stopped, [null]);
  assert.equal(existsSync(dirname(fake.runtime().dataDir)), false);
});

test("el plazo fijo de 120 segundos falla y cierra una respuesta bloqueada", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fake = fixture([]);
  const pending = probeOpenCode(config, "Probe", fake.createAgent);
  await flush();
  t.mock.timers.tick(120_000);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out after 120 seconds/);
  assert.equal(fake.sent.length, 1);
  assert.deepEqual(fake.stopped, ["session"]);
  assert.equal(existsSync(dirname(fake.runtime().dataDir)), false);
});

test("un arranque que termina tras el timeout no envía trabajo ni deja recursos", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fake = fixture();
  const start = fake.agent.start;
  const ready = Promise.withResolvers<void>();
  fake.agent.start = async (...args) => {
    const result = await start(...args);
    await ready.promise;
    return result;
  };
  const pending = probeOpenCode(config, "Probe", fake.createAgent);
  t.mock.timers.tick(120_000);
  await flush();
  ready.resolve();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/);
  assert.deepEqual(fake.sent, []);
  assert.deepEqual(fake.stopped, [null]);
  assert.equal(existsSync(dirname(fake.runtime().dataDir)), false);
});

test("SIGINT cierra la sesión y restaura los manejadores", async () => {
  const before = process.listenerCount("SIGINT");
  const fake = fixture([]);
  const pending = probeOpenCode(config, "Probe", fake.createAgent);
  await flush();
  process.emit("SIGINT");
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /cancelled/);
  assert.deepEqual(fake.stopped, ["session"]);
  assert.equal(process.listenerCount("SIGINT"), before);
});

test("un cierre incierto impide PASS y conserva el runtime para inspección", async () => {
  const fake = fixture();
  fake.agent.stop = async () => ({ exited: false, detail: "Still alive" });
  try {
    const result = await probeOpenCode(config, "Probe", fake.createAgent);
    assert.equal(result.ok, false);
    assert.match(result.error, /Still alive/);
    assert.match(result.error, /runtime retained/);
    assert.equal(existsSync(fake.runtime().dataDir), true);
  } finally {
    rmSync(dirname(fake.runtime().dataDir), { recursive: true, force: true });
  }
});

test("el comando exige --config y rechaza opciones de selección o timeout", () => {
  for (const args of [
    [],
    ["--provider", "google"],
    ["--model", "other"],
    ["--timeout", "1"],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "scripts/testOpenCode.ts", ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Result: FAIL/);
  }
});

test("el comando lee y valida el JSON explícito y permite el prompt predeterminado o propio", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundry-probe-cli-"));
  const configPath = join(root, "factory.json");
  const projectDir = join(root, "managed-project");
  const dataDir = join(root, "factory-data");
  mkdirSync(projectDir);
  writeFileSync(configPath, JSON.stringify({ ...config, projectDir, dataDir }));
  const output: string[] = [];
  t.mock.method(console, "log", (text: string) => output.push(text));
  t.mock.method(console, "error", (text: string) => output.push(text));
  try {
    for (const prompt of [undefined, "My custom prompt"]) {
      const fake = fixture();
      const code = await main(
        ["--config", configPath, ...(prompt ? ["--prompt", prompt] : [])],
        fake.createAgent,
      );
      assert.equal(code, 0);
      assert.equal(fake.sent.length, 1);
      if (prompt) {
        assert.equal(fake.sent[0], prompt);
      } else {
        assert.match(fake.sent[0], /OK.*Do not use tools/);
      }
      assert.equal(existsSync(dataDir), true);
    }
    assert.match(output.join("\n"), /google\/configured-model/);
    assert.match(output.join("\n"), /Response: OK/);
    assert.match(output.join("\n"), /Duration: \d+ ms/);
    assert.match(output.join("\n"), /Result: PASS/);
    writeFileSync(
      configPath,
      JSON.stringify({ ...config, projectDir: "/missing-project", dataDir }),
    );
    const code = await main(["--config", configPath], () =>
      assert.fail("Invalid configuration must not start OpenCode"),
    );
    assert.equal(code, 1);
    assert.match(output.at(-1)!, /Result: FAIL/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
