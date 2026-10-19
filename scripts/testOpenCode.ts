import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { AgentPort, Fact } from "../src/application/agent.ts";
import type { FactoryConfig } from "../src/application/configuration.ts";
import { sanitizer } from "../src/application/sanitize.ts";
import { readConfig } from "../src/infrastructure/configuration.ts";
import { OpenCode } from "../src/infrastructure/opencode/agent.ts";

const defaultPrompt = "Reply with OK. Do not use tools or ask questions.";
const timeoutMs = 120_000;
const usage = 'Usage: npm run test:opencode -- --config PATH [--prompt "TEXT"]';
type CreateAgent = (config: FactoryConfig) => AgentPort;

/** Probe one configured selection; no Factory workflow or persistent conversation. */
export async function probeOpenCode(
  config: FactoryConfig,
  prompt: string,
  createAgent: CreateAgent = (runtime) => new OpenCode(runtime),
) {
  const startedAt = performance.now();
  const root = mkdtempSync(join(tmpdir(), "foundry-opencode-test-"));
  const secrets: string[] = [];
  const clean = (text: string) => sanitizer(secrets)(text).text;
  const abort = new AbortController();
  const response = Promise.withResolvers<string>();
  const completedMessages = new Set<string>();
  let agent: AgentPort | undefined;
  let processStarted = false;
  let sessionId: string | null = null;
  let stopping = false;
  let task: Promise<void> | undefined;
  let text = "";
  let failure = "";
  const fail = (reason: string) => abort.abort(new Error(reason));
  const interrupt = () => fail("OpenCode test cancelled");
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort.signal.addEventListener("abort", () => reject(abort.signal.reason), {
      once: true,
    });
  });
  const emit = (fact: Fact) => {
    if (fact.type === "process-started") {
      processStarted = true;
    }
    if (stopping || abort.signal.aborted) {
      return;
    }
    if (fact.type === "usage") {
      if (
        fact.usage.provider !== config.provider ||
        fact.usage.model !== config.model
      ) {
        fail("Response provider/model differs from Factory configuration");
      } else if (fact.usage.completed) {
        completedMessages.add(fact.usage.id);
      }
    } else if (fact.type === "finished") {
      if (!fact.text.trim()) {
        fail("OpenCode returned an empty final response");
      } else if (!fact.messageId || !completedMessages.has(fact.messageId)) {
        fail("Final response provider/model could not be verified");
      } else {
        response.resolve(fact.text);
      }
    } else if (fact.type === "pending" && fact.pending.length) {
      fail("OpenCode requires human intervention");
    } else if (fact.type === "error" || fact.type === "gap") {
      fail(fact.text);
    } else if (fact.type === "process-exit") {
      fail(fact.detail);
    }
  };
  const timer = setTimeout(
    () => fail("OpenCode test timed out after 120 seconds"),
    timeoutMs,
  );
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    const dataDir = join(root, "data");
    const projectDir = join(root, "project");
    mkdirSync(dataDir, { mode: 0o700 });
    mkdirSync(projectDir, { mode: 0o700 });
    agent = createAgent({
      dataDir,
      projectDir,
      provider: config.provider,
      model: config.model,
      auth: config.auth,
      ...(config.opencodeCli ? { opencodeCli: config.opencodeCli } : {}),
    });
    const activeAgent = agent;
    task = (async () => {
      await activeAgent.start(emit, (values) => secrets.push(...values));
      processStarted = true;
      abort.signal.throwIfAborted();
      sessionId = await activeAgent.create("Factory provider smoke test");
      abort.signal.throwIfAborted();
      await activeAgent.send(sessionId, prompt);
      abort.signal.throwIfAborted();
    })();
    await Promise.race([task, interrupted]);
    text = await Promise.race([response.promise, interrupted]);
    abort.signal.throwIfAborted();
  } catch (error) {
    failure = String(error);
  } finally {
    stopping = true;
    clearTimeout(timer);
    // Let the bounded adapter call settle before stopping its process. A late
    // startup must not create a new session or outlive the temporary directory.
    await task?.catch(() => {});
    let exited = !processStarted;
    try {
      if (agent && processStarted) {
        const stopped = await agent.stop(sessionId);
        exited = stopped.exited;
        if (!exited) {
          failure += `${failure ? "\n" : ""}Cleanup failed: ${stopped.detail}`;
        }
      }
      if (exited) {
        rmSync(root, { recursive: true, force: true });
      }
    } catch (error) {
      failure += `${failure ? "\n" : ""}Cleanup failed: ${String(error)}`;
    }
    if (!exited) {
      failure += `\nProcess shutdown unconfirmed; temporary runtime retained at ${root}`;
    }
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
  if (abort.signal.aborted && !failure) {
    failure = String(abort.signal.reason);
  }

  return {
    ok: !failure,
    response: failure ? "" : clean(text),
    error: clean(failure),
    durationMs: Math.round(performance.now() - startedAt),
  };
}

export async function main(args: string[], createAgent?: CreateAgent) {
  try {
    const { values } = parseArgs({
      args,
      options: {
        config: { type: "string" },
        prompt: { type: "string" },
        help: { type: "boolean" },
      },
    });
    if (values.help) {
      console.log(usage);
      return 0;
    }
    if (!values.config?.trim() || values.prompt?.trim() === "") {
      throw new Error(usage);
    }
    const config = readConfig(values.config);
    console.log(
      sanitizer()(`Provider/model: ${config.provider}/${config.model}`).text,
    );
    const result = await probeOpenCode(
      config,
      values.prompt ?? defaultPrompt,
      createAgent,
    );
    if (result.ok) {
      console.log(`Response: ${result.response}`);
    } else {
      console.error(result.error);
    }
    console.log(`Duration: ${result.durationMs} ms`);
    console.log(`Result: ${result.ok ? "PASS" : "FAIL"}`);

    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(sanitizer()(String(error)).text);
    console.log("Result: FAIL");
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
