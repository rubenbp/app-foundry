import { createOpencodeClient, type OpencodeClient, type Event, type Message, type Part } from "@opencode-ai/sdk/v2/client";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import type { AgentPort, Fact, FactoryConfig, Pending } from "./types.ts";

export const OPENCODE_VERSION = "1.19.3";
export const policy = {
  "*": "deny", read: { "*": "allow", "*.env": "deny", "*.env.*": "deny", "*auth.json": "deny", "*.pem": "deny" },
  glob: "allow", grep: "ask", edit: "ask", bash: "deny", question: "allow", external_directory: "deny", task: "deny", skill: "deny",
} as const;

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return "Unknown OpenCode error";
  const value = error as { name?: unknown; data?: { message?: unknown } };
  return `${typeof value.name === "string" ? value.name : "OpenCode error"}: ${typeof value.data?.message === "string" ? value.data.message : "No safe error message available"}`;
}

// SSE is internal to the adapter. The panel uses ordinary HTTP polling only.
export class Observer {
  client: OpencodeClient;
  sessionId: string;
  emit: (fact: Fact) => void;
  abort = new AbortController();
  timer: ReturnType<typeof setTimeout> | undefined;
  polling = false;
  pending = new Map<string, Pending>();
  constructor(client: OpencodeClient, sessionId: string, emit: (fact: Fact) => void) {
    this.client = client; this.sessionId = sessionId; this.emit = emit;
  }
  async start() {
    let connected!: () => void;
    const ready = new Promise<void>(resolve => { connected = resolve; });
    const { stream } = await this.client.event.subscribe({}, { signal: this.abort.signal, sseMaxRetryAttempts: 1 });
    void (async () => {
      try {
        for await (const event of stream) {
          connected();
          if (this.abort.signal.aborted) break;
          this.event(event);
        }
        if (!this.abort.signal.aborted) this.emit({ type: "gap", text: "OpenCode event stream ended; short transitions may be missing. Poll reconciliation continues; task is never resent." });
      } catch {
        if (!this.abort.signal.aborted) this.emit({ type: "gap", text: "OpenCode event stream interrupted; no replay available. Poll reconciliation continues." });
      }
    })().catch(() => this.close()); // Persistence failure closes observation, never resubmits work.
    await Promise.race([ready, delay(5000, undefined, { signal: this.abort.signal }).then(() => { throw new Error("OpenCode event stream connection timeout"); })]);
  }
  message(info: Message) {
    if (info.role !== "assistant") return;
    const t = info.tokens;
    const counters = t ? [t.input, t.output, t.reasoning, t.cache?.read, t.cache?.write] : [];
    this.emit({ type: "usage", usage: {
      id: info.id, provider: info.providerID, model: info.modelID,
      tokens: counters.length === 5 && counters.every(n => Number.isFinite(n) && n >= 0) && counters.some(n => n > 0)
        ? { input: t.input, output: t.output, reasoning: t.reasoning, cacheRead: t.cache.read, cacheWrite: t.cache.write } : null,
      sdkCost: Number.isFinite(info.cost) && info.cost >= 0 ? info.cost : null, completed: Boolean(info.time.completed),
    } });
    if (info.error) this.emit({ type: "error", text: errorText(info.error) });
  }
  part(part: Part) {
    if (part.type === "text") this.emit({ type: "part", id: part.id, messageId: part.messageID, kind: "text", text: part.text });
    if (part.type === "tool") {
      const s = part.state;
      this.emit({ type: "part", id: part.id, messageId: part.messageID, kind: "tool", label: `${part.tool} · ${s.status}`,
        text: JSON.stringify({ tool: part.tool, status: s.status, input: s.input, output: s.status === "completed" ? s.output : undefined, error: s.status === "error" ? s.error : undefined }, null, 2) });
    }
  }
  event(event: Event) {
    const p = event.properties;
    if (!("sessionID" in p) || p.sessionID !== this.sessionId) return;
    switch (event.type) {
      case "session.status": this.emit({ type: "status", status: event.properties.status.type }); break;
      case "message.updated": this.message(event.properties.info); break;
      case "message.part.updated": this.part(event.properties.part); break;
      case "permission.asked": {
        const r = event.properties;
        this.pending.set(r.id, { id: r.id, kind: "permission", text: `${r.permission}: ${r.patterns.join(", ")}` });
        this.emit({ type: "pending", pending: [...this.pending.values()] }); break;
      }
      case "question.asked": {
        const r = event.properties;
        this.pending.set(r.id, { id: r.id, kind: "question", text: r.questions.map(q => q.question).join("\n") });
        this.emit({ type: "pending", pending: [...this.pending.values()] }); break;
      }
      case "permission.replied": case "question.replied": case "question.rejected":
        this.pending.delete(event.properties.requestID); this.emit({ type: "pending", pending: [...this.pending.values()] }); break;
      case "session.error": this.emit({ type: "error", text: errorText(event.properties.error) }); break;
      case "message.removed": case "message.part.removed": this.emit({ type: "gap", text: "OpenCode removed content; previously observed sanitized history retained" }); break;
    }
  }
  async poll() {
    if (this.polling || this.abort.signal.aborted) return;
    this.polling = true;
    try {
      const options = { signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(5000)]), throwOnError: true as const };
      const [messages, statuses, permissions, questions] = await Promise.all([
        this.client.session.messages({ sessionID: this.sessionId, limit: 200 }, options),
        this.client.session.status({}, options), this.client.permission.list({}, options), this.client.question.list({}, options),
      ]);
      if (this.abort.signal.aborted) return;
      const rows = messages.data ?? [];
      if (rows.length >= 200) this.emit({ type: "gap", text: "OpenCode reconciliation capped at 200 messages; coverage partial" });
      for (const row of rows) { this.message(row.info); for (const part of row.parts) this.part(part); }
      const pending: Pending[] = [
        ...(permissions.data ?? []).filter(p => p.sessionID === this.sessionId).map(p => ({ id: p.id, kind: "permission" as const, text: `${p.permission}: ${p.patterns.join(", ")}` })),
        ...(questions.data ?? []).filter(q => q.sessionID === this.sessionId).map(q => ({ id: q.id, kind: "question" as const, text: q.questions.map(i => i.question).join("\n") })),
      ];
      this.pending = new Map(pending.map(p => [p.id, p]));
      this.emit({ type: "pending", pending });
      this.emit({ type: "status", status: statuses.data?.[this.sessionId]?.type ?? "idle" });
      this.emit({ type: "observed" });
      const last = rows.filter(r => r.info.role === "assistant").at(-1);
      if (!pending.length && last?.info.role === "assistant" && last.info.time.completed && last.info.finish === "stop" && !last.info.error) {
        this.emit({ type: "finished", text: last.parts.filter(p => p.type === "text").map(p => p.text).join("\n") });
      }
    } catch (error) {
      if (!this.abort.signal.aborted) this.emit({ type: "gap", text: `OpenCode observation failed: ${String(error)}. No task retry.` });
    } finally { this.polling = false; }
  }
  watch() {
    const tick = async () => { await this.poll(); if (!this.abort.signal.aborted) this.timer = setTimeout(() => { void tick().catch(() => this.close()); }, 2000); };
    void tick().catch(() => this.close());
  }
  close() { this.abort.abort(); clearTimeout(this.timer); }
}

export class OpenCode implements AgentPort {
  config: FactoryConfig;
  process: ChildProcess | null = null;
  client: OpencodeClient | null = null;
  observer: Observer | null = null;
  runtime: string | null = null;
  emit: (fact: Fact) => void = () => {};
  stopping = false;
  constructor(config: FactoryConfig) { this.config = config; }
  async start(emit: (fact: Fact) => void) {
    this.emit = emit; this.stopping = false;
    if (this.config.provider !== "google" || !process.env.GEMINI_API_KEY) throw new Error("This increment requires google + GEMINI_API_KEY environment authentication");
    this.runtime = mkdtempSync(join(this.config.dataDir, "opencode-runtime-"));
    for (const dir of ["config", "data", "cache", "state"]) mkdirSync(join(this.runtime, dir), { mode: 0o700 });
    const password = randomBytes(32).toString("hex");
    const effective = {
      model: `${this.config.provider}/${this.config.model}`, small_model: `${this.config.provider}/${this.config.model}`,
      enabled_providers: [this.config.provider], share: "disabled", autoupdate: false, plugin: [], mcp: {}, permission: policy,
      agent: { factory: { mode: "primary", description: "Bounded Factory task", permission: policy, prompt: "Perform only the supplied bounded task. Do not delegate. Do not access secrets. Do not publish, commit, or use remote services beyond the configured model. Report what you observed; do not claim independent verification." } },
    };
    const binary = new URL("../node_modules/opencode-ai/bin/opencode.exe", import.meta.url);
    const child = spawn(binary.pathname, ["serve", "--hostname=127.0.0.1", "--port=0"], {
      cwd: this.config.projectDir, detached: true, stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH, HOME: this.runtime, TMPDIR: process.env.TMPDIR ?? "/tmp", LANG: "en_US.UTF-8",
        GOOGLE_GENERATIVE_AI_API_KEY: process.env.GEMINI_API_KEY,
        XDG_CONFIG_HOME: join(this.runtime, "config"), XDG_DATA_HOME: join(this.runtime, "data"), XDG_CACHE_HOME: join(this.runtime, "cache"), XDG_STATE_HOME: join(this.runtime, "state"),
        OPENCODE_CONFIG_CONTENT: JSON.stringify(effective), OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_SERVER_PASSWORD: password,
        GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null",
      },
    });
    this.process = child;
    if (child.pid) emit({ type: "process-started", pid: child.pid });
    child.on("exit", () => { if (!this.stopping) { try { emit({ type: "process-exit", detail: "Owned OpenCode server exited unexpectedly; remote work uncertain" }); } catch { /* Persistence fault remains visible via Factory health. */ } } });
    let startup = "";
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("OpenCode startup timeout")), 20_000);
      const fail = (error: Error) => { clearTimeout(timer); reject(error); };
      child.once("error", fail);
      child.once("exit", () => fail(new Error("OpenCode exited during startup")));
      child.stdout!.on("data", chunk => {
        startup = (startup + String(chunk)).slice(-4096);
        const match = startup.match(/opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); startup = ""; }
      });
      child.stderr!.on("data", () => {}); // Never copy raw server logs into Factory evidence.
    }).catch(async error => { await this.stop(null); throw error; });
    this.client = createOpencodeClient({ baseUrl: url, directory: this.config.projectDir, throwOnError: true, headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
      fetch: (request, init) => {
        const isEvents = String(request instanceof Request ? request.url : request).includes("/event");
        return fetch(request, { ...init, signal: isEvents ? init?.signal : AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(5000)]) });
      },
    });
    const health = await this.client.global.health();
    if (health.data?.version !== OPENCODE_VERSION) throw new Error("OpenCode version mismatch");
    const actual = (await this.client.config.get()).data;
    if (!actual || actual.model !== effective.model || !isDeepStrictEqual(actual.permission, policy) || actual.plugin?.length || Object.keys(actual.mcp ?? {}).length) throw new Error(`Effective OpenCode configuration differs from trusted policy: model=${actual?.model}; permission=${JSON.stringify(actual?.permission)}; pluginCount=${actual?.plugin?.length}; mcpCount=${Object.keys(actual?.mcp ?? {}).length}`);
    return { pid: child.pid!, version: health.data.version, configuration: { node: process.version, sdk: OPENCODE_VERSION, model: actual.model, auth: "GEMINI_API_KEY environment (omitted)", permission: policy, agent: "factory", projectDir: this.config.projectDir, server: url, inheritedEnvironment: "reduced", omissions: "credentials, provider configuration, native logs, arbitrary metadata" } };
  }
  async create() {
    if (!this.client) throw new Error("OpenCode not started");
    const session = await this.client.session.create({ title: "Factory bounded task" });
    if (!session.data) throw new Error("Session creation uncertain");
    this.observer = new Observer(this.client, session.data.id, this.emit);
    await this.observer.start();
    return session.data.id;
  }
  async send(sessionId: string, task: string) {
    if (!this.client) throw new Error("OpenCode not started");
    await this.client.session.promptAsync({ sessionID: sessionId, agent: "factory", model: { providerID: this.config.provider, modelID: this.config.model }, parts: [{ type: "text", text: task }] });
    this.observer!.watch();
  }
  async stop(sessionId: string | null) {
    this.stopping = true;
    this.observer?.close();
    let detail = "";
    if (!this.process?.pid) return { exited: false, detail: "No live owned process handle; inspect the recorded PID manually. State uncertain." };
    if (sessionId && this.client) {
      try { await this.client.session.abort({ sessionID: sessionId }); detail = "Abort acknowledged. "; }
      catch { detail = "Abort unconfirmed. "; }
    }
    const pid = this.process.pid;
    const groupAlive = () => { try { process.kill(-pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; return true; } };
    try { process.kill(-pid, "SIGTERM"); } catch { /* Checked below. */ }
    for (let i = 0; i < 20 && groupAlive(); i++) await delay(100);
    if (groupAlive()) { try { process.kill(-pid, "SIGKILL"); } catch { /* Checked below. */ } }
    for (let i = 0; i < 30 && groupAlive(); i++) await delay(100);
    const exited = !groupAlive();
    detail += exited ? `Owned process group ${pid} absent. Provider-side work/effects cannot be proven stopped or reverted.` : `Owned process group ${pid} still observable; manual inspection required.`;
    if (exited && this.runtime) rmSync(this.runtime, { recursive: true, force: true });
    this.process = null;
    return { exited, detail };
  }
}
