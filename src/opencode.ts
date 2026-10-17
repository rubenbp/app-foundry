import {
  OpenCode as NativeClient,
  type OpenCodeClient,
  type V2Event,
  type SessionMessageInfo,
  type PermissionRuleset,
  type CredentialEntry,
} from "@opencode/client";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import { once } from "node:events";
import type { AgentPort, Fact, FactoryConfig, Pending } from "./types.ts";

export const OPENCODE_VERSION = "2.0.32";
export const SDK_VERSION = "2.0.32";
export const policy: PermissionRuleset = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "read", resource: "*", effect: "allow" },
  ...["*.env", "*.env.*", "*auth.json", "*.pem"].map((resource) => ({
    action: "read",
    resource,
    effect: "deny" as const,
  })),
  { action: "glob", resource: "*", effect: "allow" },
  { action: "edit", resource: "*", effect: "ask" },
  { action: "grep", resource: "*", effect: "ask" },
  { action: "question", resource: "*", effect: "allow" },
];

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const value = error as {
    name?: string;
    _tag?: string;
    message?: string;
    data?: { message?: string };
  };

  return `${value.name ?? value._tag ?? "OpenCode error"}: ${value.message ?? value.data?.message ?? "No safe error message available"}`;
}

// The network SDK is separate from OpenCode's embedded host and stays compatible with Node 24.
export class Observer {
  client: OpenCodeClient;
  sessionId: string;
  emit: (fact: Fact) => void;
  abort = new AbortController();
  timer: ReturnType<typeof setTimeout> | undefined;
  polling = false;
  pending = new Map<string, Pending>();
  constructor(
    client: OpenCodeClient,
    sessionId: string,
    emit: (fact: Fact) => void,
  ) {
    this.client = client;
    this.sessionId = sessionId;
    this.emit = emit;
  }
  async start() {
    let connected!: () => void;
    const ready = new Promise<void>((resolve) => {
      connected = resolve;
    });
    const stream = this.client.event.subscribe({ signal: this.abort.signal });
    const timeout = setTimeout(
      () => this.abort.abort(new Error("OpenCode stream connection timeout")),
      5000,
    );
    void (async () => {
      try {
        for await (const event of stream) {
          connected();
          clearTimeout(timeout);
          if (this.abort.signal.aborted) break;
          this.event(event);
        }
        if (!this.abort.signal.aborted)
          this.emit({
            type: "gap",
            text: "OpenCode event stream ended; short transitions may be missing. Poll reconciliation continues without resending work.",
          });
      } catch {
        if (!this.abort.signal.aborted)
          this.emit({
            type: "gap",
            text: "OpenCode event stream interrupted. Poll reconciliation continues; replay is not assumed.",
          });
      } finally {
        clearTimeout(timeout);
        connected();
      }
    })().catch(() => this.close());
    await ready;
    this.abort.signal.throwIfAborted();
  }
  message(message: SessionMessageInfo) {
    if (message.type !== "assistant") return;
    const t = message.tokens;
    const counters = t
      ? [t.input, t.output, t.reasoning, t.cache?.read, t.cache?.write]
      : [];
    this.emit({
      type: "usage",
      usage: {
        id: message.id,
        provider: message.model.providerID,
        model: message.model.id,
        tokens:
          t &&
          counters.length === 5 &&
          counters.every((n) => Number.isFinite(n) && n >= 0) &&
          counters.some((n) => n > 0)
            ? {
                input: t.input,
                output: t.output,
                reasoning: t.reasoning,
                cacheRead: t.cache.read,
                cacheWrite: t.cache.write,
              }
            : null,
        sdkCost:
          message.cost !== undefined &&
          Number.isFinite(message.cost) &&
          message.cost >= 0
            ? message.cost
            : null,
        completed: Boolean(message.time.completed),
      },
    });
    if (message.error)
      this.emit({ type: "error", text: errorText(message.error) });
    for (const [index, part] of message.content.entries()) {
      if (part.type === "text")
        this.emit({
          type: "part",
          id: `${message.id}-text-${index}`,
          messageId: message.id,
          kind: "text",
          text: part.text,
        });
      if (part.type === "tool") {
        const state = part.state;
        const content =
          "content" in state
            ? (state.content ?? [])
                .flatMap((c) => (c.type === "text" ? [c.text] : []))
                .join("\n")
            : "";
        this.emit({
          type: "part",
          id: part.id,
          messageId: message.id,
          kind: "tool",
          label: `${part.name} · ${state.status}`,
          text: JSON.stringify(
            {
              tool: part.name,
              status: state.status,
              input: state.input,
              output: content,
              error:
                state.status === "error" ? errorText(state.error) : undefined,
            },
            null,
            2,
          ),
        });
      }
    }
  }
  event(event: V2Event) {
    const data = event.data;
    if (!("sessionID" in data) || data.sessionID !== this.sessionId) return;
    if (event.type === "session.status")
      this.emit({ type: "status", status: event.data.status.type });
    else if (event.type === "session.step.started")
      this.emit({ type: "status", status: "busy" });
    else if (event.type === "session.step.failed")
      this.emit({ type: "error", text: errorText(event.data.error) });
    else if (event.type === "session.execution.failed")
      this.emit({ type: "error", text: errorText(event.data.error) });
    else if (event.type === "permission.asked") {
      const p = event.data;
      this.pending.set(p.id, {
        id: p.id,
        kind: "permission",
        text: `${p.action}: ${p.resources.join(", ")}`,
      });
      this.emit({ type: "pending", pending: [...this.pending.values()] });
    } else if (event.type === "permission.replied") {
      this.pending.delete(event.data.requestID);
      this.emit({ type: "pending", pending: [...this.pending.values()] });
    } else if (event.type.startsWith("session.tool.")) {
      this.emit({
        type: "status",
        status: event.type.slice("session.".length),
      });
    }
  }
  async poll() {
    if (this.polling || this.abort.signal.aborted) return;
    this.polling = true;
    try {
      const signal = AbortSignal.any([
        this.abort.signal,
        AbortSignal.timeout(5000),
      ]);
      const options = { signal, throwOnError: true as const };
      const [messages, active, permissions, forms] = await Promise.all([
        this.client.message.list(
          { sessionID: this.sessionId, limit: 200, order: "asc" },
          options,
        ),
        this.client.session.active(options),
        this.client.permission.request.list({}, options),
        this.client.form.list({}, options),
      ]);
      if (this.abort.signal.aborted) return;
      let page = messages;
      let last: SessionMessageInfo | undefined;
      const cursors = new Set<string>();
      while (true) {
        signal.throwIfAborted();
        const rows = page.data ?? [];
        for (const row of rows) {
          this.message(row);
          if (row.type === "assistant") last = row;
        }
        const next = page.cursor.next;
        if (!rows.length || !next) break;
        if (cursors.has(next))
          throw new Error(
            "OpenCode repeated a message cursor; coverage partial",
          );
        cursors.add(next);
        page = await this.client.message.list(
          { sessionID: this.sessionId, limit: 200, order: "asc", cursor: next },
          options,
        );
      }
      const pending: Pending[] = [
        ...(permissions.data ?? [])
          .filter((p) => p.sessionID === this.sessionId)
          .map((p) => ({
            id: p.id,
            kind: "permission" as const,
            text: `${p.action}: ${p.resources.join(", ")}`,
          })),
        ...(forms.data ?? [])
          .filter((f) => f.sessionID === this.sessionId)
          .map((f) => ({
            id: f.id,
            kind: "question" as const,
            text:
              f.title +
              "\n" +
              f.fields.map((field) => field.title ?? field.key).join("\n"),
          })),
      ];
      this.pending = new Map(pending.map((p) => [p.id, p]));
      this.emit({ type: "pending", pending });
      this.emit({
        type: "status",
        status: active[this.sessionId] ? "busy" : "idle",
      });
      this.emit({ type: "observed" });
      if (
        !pending.length &&
        last?.type === "assistant" &&
        last.time.completed &&
        last.finish === "stop" &&
        !last.error
      ) {
        this.emit({
          type: "finished",
          text: last.content
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n"),
        });
      }
    } catch (error) {
      if (!this.abort.signal.aborted)
        this.emit({
          type: "gap",
          text: `OpenCode observation failed: ${errorText(error)}. No task retry.`,
        });
    } finally {
      this.polling = false;
    }
  }
  watch() {
    const tick = async () => {
      await this.poll();
      if (!this.abort.signal.aborted)
        this.timer = setTimeout(() => {
          void tick().catch(() => this.close());
        }, 2000);
    };
    void tick().catch(() => this.close());
  }
  close() {
    this.abort.abort();
    clearTimeout(this.timer);
  }
}

export class OpenCode implements AgentPort {
  config: FactoryConfig;
  process: ChildProcess | null = null;
  client: OpenCodeClient | null = null;
  observer: Observer | null = null;
  runtime: string | null = null;
  emit: (fact: Fact) => void = () => {};
  stopping = false;
  constructor(config: FactoryConfig) {
    this.config = config;
  }
  async start(
    emit: (fact: Fact) => void,
    protect: (secrets: string[]) => void = () => {},
  ) {
    this.emit = emit;
    this.stopping = false;
    if (
      this.config.provider !== "openai" ||
      this.config.model !== "gpt-6-luna" ||
      !this.config.opencodeCli
    )
      throw new Error(
        "Requires openai/gpt-6-luna with an opencodeCli supporting OAuth export",
      );
    const binary = new URL(
      "../node_modules/@opencode/cli/bin/opencode.exe",
      import.meta.url,
    ).pathname;
    const version = spawnSync(binary, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (
      version.status !== 0 ||
      !version.stdout.includes(`v${OPENCODE_VERSION}`)
    )
      throw new Error(
        "OpenCode OAuth export unavailable or version mismatch; requires 2.0.32",
      );
    const exported = spawnSync(
      this.config.opencodeCli,
      ["auth", "export", "openai"],
      { encoding: "utf8", timeout: 5000, maxBuffer: 1_000_000 },
    );
    if (exported.status !== 0)
      throw new Error("OpenCode OAuth export unavailable; log in first");
    const credentials = JSON.parse(exported.stdout) as CredentialEntry[];
    const selected = credentials.find((c) => c.active);
    if (
      !selected ||
      selected.value.type !== "oauth" ||
      !selected.value.access ||
      !selected.value.refresh
    )
      throw new Error("No active OpenAI OAuth credential in OpenCode");
    protect([selected.value.access, selected.value.refresh]);
    this.runtime = mkdtempSync(join(this.config.dataDir, "opencode-runtime-"));
    mkdirSync(join(this.runtime, "config", "opencode"), {
      recursive: true,
      mode: 0o700,
    });
    const effective = {
      model: "openai/gpt-6-luna",
      default_agent: "factory",
      update: "disable",
      warming: false,
      snapshots: false,
      permissions: policy,
      plugins: [],
      agents: {
        factory: {
          mode: "primary",
          model: "openai/gpt-6-luna#low",
          description: "Bounded Factory task",
          permissions: policy,
          system:
            "Perform only the supplied bounded task. Never delegate or access secrets. Do not publish or commit. Report observations without claiming independent verification.",
        },
      },
    };
    writeFileSync(
      join(this.runtime, "config", "opencode", "opencode.json"),
      JSON.stringify(effective),
      { mode: 0o600 },
    );
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const url = `http://127.0.0.1:${port}`;
    const password = randomBytes(32).toString("hex");
    const env = {
      PATH: process.env.PATH,
      HOME: this.runtime,
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      LANG: "en_US.UTF-8",
      XDG_CONFIG_HOME: join(this.runtime, "config"),
      XDG_DATA_HOME: join(this.runtime, "data"),
      XDG_CACHE_HOME: join(this.runtime, "cache"),
      XDG_STATE_HOME: join(this.runtime, "state"),
      OPENCODE_CONFIG_PROJECT_DISABLE: "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_SERVER_PASSWORD: password,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: "/dev/null",
    };
    const child = spawn(
      binary,
      ["serve", "--hostname=127.0.0.1", `--port=${port}`],
      { cwd: this.config.projectDir, detached: true, stdio: "ignore", env },
    );
    this.process = child;
    if (child.pid) emit({ type: "process-started", pid: child.pid });
    child.on("error", () => {});
    child.on("exit", () => {
      if (!this.stopping) {
        try {
          emit({
            type: "process-exit",
            detail:
              "Owned OpenCode server exited unexpectedly; remote work uncertain",
          });
        } catch {
          /* Existing persistence fault remains visible. */
        }
      }
    });
    const headers = {
      Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    };
    this.client = NativeClient.make({
      baseUrl: url,
      headers,
      fetch: (request, init) => {
        const signal =
          init?.signal ??
          (request instanceof Request ? request.signal : undefined);
        const streaming = String(
          request instanceof Request ? request.url : request,
        ).includes("/event");

        return fetch(request, {
          ...init,
          signal: streaming
            ? signal
            : AbortSignal.any([
                ...(signal ? [signal] : []),
                AbortSignal.timeout(5000),
              ]),
        });
      },
    });
    let info: Awaited<ReturnType<OpenCodeClient["server"]["info"]>> | undefined;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null)
        throw new Error("Owned OpenCode server exited during startup");
      try {
        info = await this.client.server.info({
          signal: AbortSignal.timeout(500),
        });
        if (info.version) break;
      } catch {
        /* Startup reads only; no model effect retried. */
      }
      await delay(250);
    }
    if (info?.version !== OPENCODE_VERSION || info.pid !== child.pid)
      throw new Error("Owned OpenCode identity/version not confirmed");
    await this.client.credential.create({
      integrationID: selected.integrationID,
      value: selected.value,
      activate: true,
      label: "Factory temporary OAuth",
    });
    let agents =
      (
        await this.client.agent.list({
          location: { directory: this.config.projectDir },
        })
      ).data ?? [];
    for (let i = 0; i < 20 && !agents.some((a) => a.id === "factory"); i++) {
      await delay(250);
      agents =
        (
          await this.client.agent.list({
            location: { directory: this.config.projectDir },
          })
        ).data ?? [];
    }
    const actual = agents.find((a) => a.id === "factory");
    const start =
      actual?.permissions.findLastIndex(
        (rule) =>
          rule.action === "*" &&
          rule.resource === "*" &&
          rule.effect === "deny",
      ) ?? -1;
    const validPolicy =
      actual &&
      start >= 0 &&
      isDeepStrictEqual(
        actual.permissions.slice(start, start + policy.length),
        policy,
      ) &&
      actual.permissions
        .slice(start + policy.length)
        .every((rule) => rule.effect === "deny");
    if (!actual || actual.model?.id !== "gpt-6-luna" || !validPolicy) {
      const sources = await this.client.config.get({
        location: { directory: this.config.projectDir },
      });
      throw new Error(
        `Effective Factory agent/model/tool policy differs from trusted configuration: ${JSON.stringify({ ids: agents.map((a) => a.id), model: actual?.model, permissions: actual?.permissions, sources: sources.map((s) => ({ path: s.path, type: s.type, agents: s.type === "document" ? Object.keys(s.info.agents ?? {}) : [] })) })}`,
      );
    }
    return {
      pid: child.pid!,
      version: info.version,
      configuration: {
        node: process.version,
        sdk: SDK_VERSION,
        model: actual.model,
        auth: "OpenCode active OpenAI OAuth (credentials omitted)",
        opencodeCli: this.config.opencodeCli,
        permissions: actual.permissions,
        agent: "factory",
        projectDir: this.config.projectDir,
        server: url,
        inheritedEnvironment: "reduced",
        omissions:
          "credentials, provider configuration, native logs, arbitrary metadata",
      },
    };
  }
  async create() {
    if (!this.client) throw new Error("OpenCode not started");
    const session = await this.client.session.create({
      agent: "factory",
      model: { providerID: "openai", id: "gpt-6-luna", variant: "low" },
      location: { directory: this.config.projectDir },
    });
    const id = session.id;
    if (!id) throw new Error("Session creation uncertain");
    this.observer = new Observer(this.client, id, this.emit);
    await this.observer.start();
    return id;
  }
  async send(sessionId: string, task: string) {
    if (!this.client) throw new Error("OpenCode not started");
    await this.client.session.prompt({ sessionID: sessionId, text: task });
    this.observer!.watch();
  }
  async stop(sessionId: string | null) {
    this.stopping = true;
    this.observer?.close();
    let detail = "";
    if (!this.process?.pid)
      return {
        exited: false,
        detail:
          "No live owned process handle; inspect the recorded PID manually. State uncertain.",
      };
    if (sessionId && this.client) {
      try {
        await this.client.session.interrupt({ sessionID: sessionId });
        detail = "Interrupt acknowledged. ";
      } catch {
        detail = "Interrupt unconfirmed. ";
      }
    }
    const pid = this.process.pid;
    const alive = () => {
      try {
        process.kill(-pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code !== "ESRCH";
      }
    };
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      /* Checked below. */
    }
    for (let i = 0; i < 20 && alive(); i++) await delay(100);
    if (alive()) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* Checked below. */
      }
    }
    for (let i = 0; i < 30 && alive(); i++) await delay(100);
    const exited = !alive();
    detail += exited
      ? `Owned process group ${pid} absent. Provider-side work/effects cannot be proven stopped or reverted.`
      : `Owned process group ${pid} still observable; manual inspection required.`;
    if (exited && this.runtime)
      rmSync(this.runtime, { recursive: true, force: true });
    this.process = null;
    return { exited, detail };
  }
}
