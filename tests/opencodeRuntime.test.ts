import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  existsSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "../src/infrastructure/opencode/agent.ts";
import { snapshotSkills } from "../src/infrastructure/opencode/skills.ts";
import { createServer } from "node:http";
import { once } from "node:events";

for (const mode of ["manual", "workflow"]) {
  test(
    `OpenCode real aplica permisos de ${mode} y conserva el thread sin llamar al modelo`,
    { timeout: 60_000 },
    async () => {
      const root = mkdtempSync(join(tmpdir(), "foundry-conversation-"));
      const projectDirectory = join(root, "project");
      mkdirSync(projectDirectory);
      const source = join(root, "factory-skills");
      const runtime = join(root, "conversations", "issue-1");
      const skillFile = join(source, "review", "SKILL.md");
      mkdirSync(join(source, "review"), { recursive: true });
      writeFileSync(
        skillFile,
        "---\nname: Factory review\ndescription: Review the requested change\n---\nOriginal Factory instructions.",
      );
      const skills = snapshotSkills(source, runtime);
      // Fuentes ajenas al catálogo: global privada y repositorio del producto.
      for (const [base, id] of [
        [runtime, "global-review"],
        [runtime, "review"],
        [projectDirectory, "project-review"],
      ]) {
        const directory = join(base, ".agents", "skills", id);
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          join(directory, "SKILL.md"),
          "---\nname: Foreign review\ndescription: Foreign instructions\n---\nDo not load this skill.",
        );
      }
      const exporter = join(root, "auth-export");
      const credentials = [
        {
          active: true,
          integrationID: "openai",
          value: {
            type: "oauth",
            methodID: "oauth",
            access: "fictional-access",
            refresh: "fictional-refresh",
            expires: Date.now() + 3_600_000,
          },
        },
      ];
      writeFileSync(
        exporter,
        `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(credentials))});\n`,
        { mode: 0o700 },
      );
      const config = {
        dataDir: root,
        projectDir: projectDirectory,
        provider: "openai",
        model: "gpt-6-luna",
        auth: "opencode" as const,
        opencodeCli: exporter,
        conversationId: "issue-1",
        ...(mode === "workflow"
          ? {
              managedProject: {
                id: "runtime-test",
                repository: "team/runtime-test",
                baseBranch: "main",
                instructions: ["README.md"],
                preparation: { command: "npm install" },
                verification: { commands: ["npm test"] },
                publication: {
                  provider: "vercel" as const,
                  projectId: "runtime-test",
                  humanMergeRequired: true as const,
                },
              },
            }
          : {}),
      };
      const first = new OpenCode(config);
      const restarted = new OpenCode(config);
      const attached = new OpenCode(config);
      let sessionId: string | null = null;
      try {
        await first.start(() => {});
        const available = (
          await first.client!.skill.list({
            location: { directory: projectDirectory },
          })
        ).data;
        const review = available.find((skill) => skill.id === "review");
        assert.equal(review?.path, skills.entries[0].path);
        assert.equal(review?.name, "Factory review");
        assert.equal(review?.description, "Review the requested change");
        assert.match(review.content, /Original Factory instructions/);
        assert.ok(available.some((skill) => skill.id === "global-review"));
        assert.ok(!available.some((skill) => skill.id === "project-review"));
        const agents = (
          await first.client!.agent.list({
            location: { directory: projectDirectory },
          })
        ).data;
        const actual = agents?.find((agent) => agent.id === "factory");
        assert.ok(actual);
        const start = actual.permissions.findLastIndex(
          (rule) =>
            rule.action === "*" &&
            rule.resource === "*" &&
            rule.effect === "deny",
        );
        assert.ok(start >= 0);
        const permissions = actual.permissions.slice(start);
        const shell = permissions.findLast(
          (rule) => rule.action === "shell" && rule.resource === "*",
        );
        assert.equal(shell?.effect, mode === "workflow" ? "allow" : undefined);
        assert.ok(
          permissions.some(
            (rule) =>
              rule.action === "read" &&
              rule.resource === "*.env" &&
              rule.effect === "deny",
          ),
        );
        assert.equal(
          permissions.findLast(
            (rule) => rule.action === "edit" && rule.resource === "*",
          )?.effect,
          mode === "workflow" ? "allow" : "ask",
        );
        if (mode === "workflow") {
          assert.ok(
            permissions.some(
              (rule) =>
                rule.action === "edit" &&
                rule.resource === "*.git/*" &&
                rule.effect === "deny",
            ),
          );
        }
        sessionId = await first.create();
        for (const [action, resource, expected] of [
          ["skill", "review", "allow"],
          ["skill", "global-review", "deny"],
          ["skill", "project-review", "deny"],
          ["external_directory", `${skills.directory}/*`, "allow"],
          ["read", skills.entries[0].path, "allow"],
          ["edit", skills.entries[0].path, "deny"],
        ]) {
          const permission = await first.client!.permission.create({
            sessionID: sessionId,
            agent: "factory",
            action,
            resources: [resource],
          });
          assert.equal(permission.effect, expected);
        }
        await first.client!.session.skill({
          sessionID: sessionId,
          id: "review",
          resume: false,
        });
        const context = await first.client!.session.context({
          sessionID: sessionId,
        });
        assert.ok(
          context.some(
            (message) =>
              message.type === "skill" &&
              message.skill === "review" &&
              message.text.includes("Original Factory instructions"),
          ),
        );
        await first.client!.session.update({
          sessionID: sessionId,
          title: "Dudas de producto pendientes",
        });
        const original = await first.client!.session.export({
          sessionID: sessionId,
        });
        original.messages.push(
          {
            id: "msg_human_context",
            type: "user",
            time: { created: Date.now() },
            text: "Conserva la navegación con teclado.",
          },
          {
            id: "msg_pending_questions",
            type: "assistant",
            agent: "factory",
            model: { providerID: "openai", id: "gpt-6-luna" },
            time: { created: Date.now(), completed: Date.now() },
            finish: "stop",
            content: [
              {
                type: "text",
                text: "<factory-intervention>\n¿Qué título?\n¿Mostramos precios?\n</factory-intervention>",
              },
            ],
          },
        );
        // Prepara un historial conocido sin iniciar una ejecución del modelo.
        await first.client!.session.remove({ sessionID: sessionId });
        await first.client!.session.import(original);
        const stopped = await first.stop(sessionId);
        assert.ok(stopped.exited, stopped.detail);
        assert.ok(existsSync(join(root, "conversations", "issue-1", "data")));
        writeFileSync(skillFile, "Changed after the first attempt.");
        const process = await restarted.start(() => {});
        const afterRestart = (
          await restarted.client!.skill.list({
            location: { directory: projectDirectory },
          })
        ).data.find((skill) => skill.id === "review");
        assert.match(afterRestart!.content, /Original Factory instructions/);
        await restarted.resume(sessionId);
        const restored = await restarted.client!.session.export({
          sessionID: sessionId,
        });
        assert.equal(restored.info.id, original.info.id);
        assert.equal(restored.info.title, "Dudas de producto pendientes");
        assert.deepEqual(restored.messages, original.messages);
        const reused = await attached.start(() => {});
        assert.equal(reused.pid, process.pid);
        await attached.resume(sessionId);
        assert.equal(
          (await attached.client!.session.get({ sessionID: sessionId })).id,
          sessionId,
        );
      } finally {
        first.observer?.close();
        restarted.observer?.close();
        attached.observer?.close();
        for (const agent of [attached, restarted, first]) {
          if (agent.ownedPid) {
            await agent.stop(sessionId);
          }
        }
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}

test(
  "Gemini y Anthropic importan claves y seleccionan modelos del catálogo nativo sin llamar al modelo",
  { timeout: 60_000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "foundry-api-runtime-"));
    const projectDir = join(root, "project");
    mkdirSync(projectDir);
    const exporter = join(root, "export");
    const writeCredential = (integrationID: string, value: object) =>
      writeFileSync(
        exporter,
        `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify([{ active: true, integrationID, value }]))});`,
        { mode: 0o700 },
      );
    writeCredential("openai", {
      type: "oauth",
      methodID: "oauth",
      access: "fictional-access",
      refresh: "fictional-refresh",
      expires: Date.now() + 3_600_000,
    });
    const config = {
      dataDir: root,
      projectDir,
      provider: "openai",
      model: "gpt-6-luna",
      auth: "opencode" as const,
      opencodeCli: exporter,
    };
    const catalogue = new OpenCode(config);
    const agents = [catalogue];
    try {
      await catalogue.start(() => {});
      for (const provider of ["google", "anthropic"]) {
        const key = `fictional-${provider}-key`;
        await catalogue.client!.credential.create({
          integrationID: provider,
          value: { type: "key", key },
          activate: true,
        });
        const models = (
          await catalogue.client!.model.list({
            location: { directory: projectDir },
          })
        ).data;
        const model = models.find(
          (model) =>
            model.providerID === provider &&
            model.enabled &&
            model.capabilities.tools,
        );
        assert.ok(
          model,
          `${provider} catalog must expose a tool-capable model`,
        );
        writeCredential(provider, { type: "key", key });
        const agent = new OpenCode({ ...config, provider, model: model.id });
        agents.push(agent);
        const protectedValues: string[] = [];
        const started = await agent.start(
          () => {},
          (values) => protectedValues.push(...values),
        );
        assert.ok(protectedValues.includes(key));
        assert.doesNotMatch(JSON.stringify(started), new RegExp(key));
        assert.doesNotMatch(
          readFileSync(
            join(agent.runtime!, "config", "opencode", "opencode.json"),
            "utf8",
          ),
          new RegExp(key),
        );
        const sessionId = await agent.create();
        const session = await agent.client!.session.get({
          sessionID: sessionId,
        });
        assert.equal(session.model?.providerID, provider);
        assert.equal(session.model?.id, model.id);
        await agent.resume(sessionId);
        await agent.stop(sessionId);
      }
      const invalid = new OpenCode({
        ...config,
        provider: "anthropic",
        model: "factory-model-that-does-not-exist",
      });
      agents.push(invalid);
      await assert.rejects(
        invalid.start(() => {}),
        /model unavailable/,
      );
    } finally {
      for (const agent of agents.reverse()) {
        agent.observer?.close();
        if (agent.ownedPid) {
          await agent.stop(null);
        }
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "Ollama descubre un modelo local con herramientas sin credenciales ni llamadas de generación",
  { timeout: 30_000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "foundry-ollama-runtime-"));
    const projectDir = join(root, "project");
    mkdirSync(projectDir);
    let tools = true;
    const requests: string[] = [];
    const name = "factory-test-coder:local";
    const server = createServer((request, response) => {
      requests.push(request.url!);
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/tags") {
        response.end(
          JSON.stringify({
            models: [
              {
                name,
                model: name,
                modified_at: "2026-10-19T00:00:00Z",
                size: 1000,
                digest: "test-digest",
                details: {
                  format: "gguf",
                  family: "qwen3",
                  parameter_size: "8B",
                  quantization_level: "Q4_K_M",
                },
              },
            ],
          }),
        );
      } else if (request.url === "/api/show") {
        response.end(
          JSON.stringify({
            capabilities: ["completion", ...(tools ? ["tools"] : [])],
            model_info: {
              "general.architecture": "qwen3",
              "qwen3.context_length": 65536,
            },
          }),
        );
      } else {
        response.statusCode = 404;
        response.end("{}");
      }
    });
    const agents: OpenCode[] = [];
    try {
      server.listen(11434, "127.0.0.1");
      try {
        await once(server, "listening");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
          t.skip(
            "A local Ollama service owns port 11434; do not contact or replace it",
          );
          return;
        }
        throw error;
      }
      const config = {
        dataDir: root,
        projectDir,
        provider: "ollama",
        model: name,
        auth: "opencode" as const,
      };
      const agent = new OpenCode(config);
      agents.push(agent);
      const started = await agent.start(() => {});
      assert.equal(started.configuration.auth, "Local Ollama (no credentials)");
      const id = await agent.create();
      const session = await agent.client!.session.get({ sessionID: id });
      assert.equal(session.model?.providerID, "ollama");
      assert.equal(session.model?.id, name);
      assert.ok(requests.includes("/api/tags"));
      assert.ok(requests.includes("/api/show"));
      tools = false;
      const unsupported = new OpenCode(config);
      agents.push(unsupported);
      await assert.rejects(
        unsupported.start(() => {}),
        /does not support tools/,
      );
      assert.ok(
        requests.every((url) => url === "/api/tags" || url === "/api/show"),
      );
    } finally {
      for (const agent of agents) {
        agent.observer?.close();
        if (agent.ownedPid) {
          await agent.stop(null);
        }
      }
      server.closeAllConnections();
      server.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
