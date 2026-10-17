import { randomUUID } from "node:crypto";
import { Store } from "./store.ts";
import { sanitizer } from "./sanitize.ts";
import type { AgentPort, Fact, FactoryConfig, Run } from "./types.ts";

export class Factory {
  store: Store;
  config: FactoryConfig;
  agent: AgentPort;
  now: () => number;
  clean: ReturnType<typeof sanitizer>;
  active: string | null = null;
  fault: string | null = null;
  stopping = new Set<string>();
  constructor(config: FactoryConfig, agent: AgentPort, options: { secrets?: string[]; now?: () => number } = {}) {
    this.config = config;
    this.agent = agent;
    this.now = options.now ?? Date.now;
    this.clean = sanitizer(options.secrets);
    this.store = new Store(config.dataDir);
    for (const run of this.store.list()) {
      if (run.status !== "stopped") {
        run.status = "intervention";
        run.error = "Factory restarted. Work/process state uncertain; no task was resent. Inspect owned PID before recovery.";
        run.gaps.push("Observation interrupted by Factory restart");
        this.record(run, "recovery", run.error);
        this.store.save(run);
        this.active = run.id;
      }
    }
  }
  record(run: Run, kind: string, text: string) { run.history.push({ at: this.now(), kind, text: this.clean(text, 4096).text }); }
  persist(run: Run) {
    try { this.store.save(run); } catch (error) {
      this.fault = "Persistence failed; new effects blocked. Stop the owned process manually using the recorded PID.";
      throw error;
    }
  }
  assertWritable() { if (this.store.failed || this.fault) throw new Error("Persistence unavailable: effects blocked"); }
  assertRunning(id: string) {
    this.assertWritable();
    if (this.stopping.has(id) || this.active !== id || this.view(id)?.status === "stopped") throw new Error("Ejecución stopped while effect was in flight; no further task will be sent");
  }
  async run(task: string) {
    this.assertWritable();
    if (this.active) throw new Error("One Ejecución already occupies the Factory");
    if (!task.trim()) throw new Error("Task required");
    const run: Run = {
      id: randomUUID(), attempt: 1, task: this.clean(task).text, status: "starting", startedAt: this.now(), endedAt: null,
      sessionId: null, process: null, lastObservation: null, lastActivity: null, agentStatus: null, error: null, result: null,
      pending: [], parts: [], usage: [], history: [], gaps: ["Only selected SDK fields retained; authentication, reasoning and arbitrary metadata omitted"],
    };
    this.record(run, "intent", "Start owned OpenCode server");
    this.persist(run);
    this.active = run.id;
    try {
      const process = await this.agent.start(fact => this.ingest(run.id, fact));
      this.assertRunning(run.id);
      Object.assign(run, this.view(run.id));
      run.process = JSON.parse(this.clean(JSON.stringify(process)).text);
      this.record(run, "intent", "Create OpenCode session"); this.persist(run);
      run.sessionId = await this.agent.create();
      this.assertRunning(run.id);
      run.status = "running";
      this.record(run, "intent", "Send task once; no automatic retry"); this.persist(run);
      await this.agent.send(run.sessionId, task);
    } catch (error) {
      if (this.store.failed) throw error;
      if (this.view(run.id)?.status !== "stopped") this.ingest(run.id, { type: "error", text: `Effect uncertain: ${String(error)}` });
    }
    return this.view(run.id)!;
  }
  ingest(id: string, fact: Fact) {
    this.assertWritable();
    const run = this.view(id);
    if (!run) return;
    const at = this.now();
    const text = "text" in fact ? this.clean(fact.text) : null;
    if (fact.type === "status" && run.agentStatus !== fact.status) {
      run.agentStatus = this.clean(fact.status, 100).text;
      run.lastActivity = at;
      this.record(run, "opencode-status", run.agentStatus);
    } else if (fact.type === "part") {
      const previous = run.parts.find(p => p.id === fact.id);
      if (this.output(id, fact.id) !== text!.text) {
        try { this.store.write(id, fact.id, text!.text); } catch (error) { this.fault = "Artifact persistence failed; effects blocked"; throw error; }
        const part = { id: fact.id, messageId: fact.messageId, kind: this.clean(fact.kind, 100).text, label: this.clean(fact.label ?? fact.kind, 200).text, updatedAt: at, truncated: text!.truncated };
        const labelChanged = previous && previous.label !== part.label;
        if (previous) Object.assign(previous, part); else run.parts.push(part);
        run.lastActivity = at;
        if (!previous || labelChanged) this.record(run, "part", `${part.kind}: ${part.label}`);
      }
    } else if (fact.type === "usage") {
      const safe = { ...fact.usage, provider: this.clean(fact.usage.provider, 200).text, model: this.clean(fact.usage.model, 200).text };
      const index = run.usage.findIndex(u => u.id === safe.id);
      if (index < 0) run.usage.push(safe); else if (!run.usage[index].completed || safe.completed) run.usage[index] = safe;
    } else if (fact.type === "pending") {
      const pending = fact.pending.map(p => ({ id: p.id, kind: p.kind, text: this.clean(p.text, 4096).text }));
      if (JSON.stringify(run.pending) !== JSON.stringify(pending)) {
        run.pending = pending; run.lastActivity = at;
        if (pending.length) run.status = "waiting";
        else if (run.status === "waiting") run.status = "running";
        this.record(run, "pending", pending.length ? pending.map(p => `${p.kind}: ${p.text}`).join("\n") : "No pending requests");
      }
    } else if (fact.type === "finished" && run.status !== "intervention" && run.status !== "stopped") {
      run.result = text!.text; run.status = "awaiting_verification";
      if (!run.endedAt) { run.endedAt = at; this.record(run, "result", "Agent finished. Result unverified; no acceptance or publication accredited."); }
    } else if (fact.type === "error") {
      run.error = text!.text; run.status = "intervention"; this.record(run, "error", text!.text);
    } else if (fact.type === "gap") {
      if (!run.gaps.includes(text!.text)) { run.gaps.push(text!.text); this.record(run, "gap", text!.text); }
    } else if (fact.type === "process-exit") {
      if (run.process) run.process.exited = true;
      run.status = "intervention";
      run.error = this.clean(fact.detail).text;
      this.record(run, "process-exit", run.error);
    }
    if (fact.type === "observed") run.lastObservation = at;
    if (fact.type === "process-started") {
      run.process = { pid: fact.pid, version: "unconfirmed", configuration: { omissions: "Startup configuration not yet observed" } };
      this.record(run, "process-started", `Owned OpenCode PID ${fact.pid}; version/configuration awaiting observation`);
    }
    this.persist(run);
  }
  async stop(id: string) {
    this.assertWritable();
    const run = this.view(id);
    if (!run || this.active !== id) throw new Error("Ejecución is not active");
    this.stopping.add(id);
    this.record(run, "intent", "Abort session and stop owned process group"); this.persist(run);
    let result;
    try { result = await this.agent.stop(run.sessionId); }
    catch (error) { result = { exited: false, detail: `Stop unconfirmed: ${String(error)}` }; }
    const latest = this.view(id)!;
    latest.status = result.exited ? "stopped" : "intervention";
    latest.endedAt ??= this.now();
    if (latest.process) latest.process.exited = result.exited;
    latest.pending = [];
    this.record(latest, "stop", result.detail);
    this.persist(latest);
    if (result.exited) this.active = null;
    return latest;
  }
  view(id: string) { return this.store.list().find(r => r.id === id) ?? null; }
  list() { return this.store.list(); }
  output(id: string, partId: string) { return this.store.output(id, partId); }
  close() { this.store.close(); }
}
