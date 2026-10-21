import type {
  AgentConfiguration,
  AuthorizedIssue,
  Workspace,
} from "../domain/request.ts";
import { randomUUID } from "node:crypto";
import type { RunRepository } from "./runRepository.ts";
import { sanitizer, sanitizedRecord } from "./sanitize.ts";
import type { AgentPort, Fact } from "./agent.ts";
import type { FactoryConfig } from "./configuration.ts";
import type { Run } from "../domain/run.ts";
import { agentDelivery } from "./agentDelivery.ts";
import {
  interventionQuestions,
  pendingIntervention,
} from "../domain/intervention.ts";
import type { IssueComment } from "../domain/intervention.ts";

export class Factory {
  store: RunRepository;
  config: FactoryConfig;
  agent: AgentPort;
  now: () => number;
  clean: ReturnType<typeof sanitizer>;
  secrets: string[];
  active: string | null = null;
  fault: string | null = null;
  stopping = new Set<string>();
  /** Wake the workflow after a persisted candidate, without running remote effects in ingest. */
  onCandidateReady?: () => void;

  constructor(
    config: FactoryConfig,
    agent: AgentPort,
    store: RunRepository,
    options: {
      secrets?: string[];
      now?: () => number;
      reservedRun?: string;
    } = {},
  ) {
    this.config = Object.freeze({ ...config });
    this.agent = agent;
    this.now = options.now ?? Date.now;
    this.secrets = options.secrets ?? [];
    this.clean = sanitizer(this.secrets);
    this.store = store;
    // Check every pending run before recovery writes or any external effect.
    for (const run of this.store.list()) {
      const selection = this.recordedSelection(run);
      const initiated =
        run.status !== "queued" ||
        run.phase !== undefined ||
        run.sessionId !== null ||
        run.process !== null ||
        options.reservedRun === run.id;
      if (
        run.status !== "completed" &&
        run.status !== "stopped" &&
        initiated &&
        selection &&
        (selection.provider !== config.provider ||
          selection.model !== config.model ||
          selection.reasoningEffort !== config.reasoningEffort)
      ) {
        throw new Error(
          `No se puede arrancar la Factory: la Ejecución ${run.id} usa ${selection.provider}/${selection.model} (reasoningEffort: ${selection.reasoningEffort ?? "predeterminado"}); la configuración global indica ${config.provider}/${config.model} (reasoningEffort: ${config.reasoningEffort ?? "predeterminado"}). Arranca con la selección anterior y termina o cancela esa Ejecución antes de cambiar.`,
        );
      }
    }
    for (const run of this.store.list()) {
      if (
        run.status === "waiting" &&
        run.request &&
        run.workspace &&
        run.sessionId &&
        pendingIntervention(run.interventions)
      ) {
        this.active = run.id;
        this.record(
          run,
          "recovery",
          "Human reply still pending; preserve the same agent conversation without resending the task",
        );
        this.store.save(run);
        continue;
      }
      if (
        run.status !== "stopped" &&
        run.status !== "completed" &&
        run.status !== "queued"
      ) {
        run.status = "intervention";
        // The previous process cannot still be handling an order after restart.
        if (run.recovery?.lastAction?.finishedAt === Number.MAX_SAFE_INTEGER) {
          delete run.recovery.lastAction;
        }
        run.error =
          "La Factory se reinició. El estado del trabajo o del proceso no está confirmado; no se reenvió la tarea. Comprueba el PID propio antes de recuperar.";
        if (run.publication) {
          run.publication.recoveryRequired = true;
        }
        if (run.verification?.status === "running") {
          run.verification.effectsUncertain = run.verification.checks.some(
            (check) =>
              check.status === "running" ||
              check.cleanup === "pending" ||
              check.cleanup === "uncertain",
          );
          run.verification.status = "intervention";
          run.verification.error = run.error;
          for (const check of run.verification.checks) {
            if (check.status === "running" || check.cleanup === "pending") {
              check.status = "uncertain";
              check.cleanup = "uncertain";
              run.error += ` El grupo de procesos del comando de verificación (${check.pid ?? "no disponible"}) requiere una inspección manual.`;
            }
          }
          run.verification.error = run.error;
        }
        run.gaps.push("La observación se interrumpió al reiniciar la Factory");
        this.record(run, "recovery", run.error);
        this.store.save(run);
        this.active = run.id;
      }
    }
  }

  private recordedSelection(
    run: Run,
  ):
    | Pick<AgentConfiguration, "provider" | "model" | "reasoningEffort">
    | undefined {
    const selection = run.request?.runtime ?? run.runtime;
    if (selection) {
      return selection;
    }
    // Older manual runs recorded the effective model only in process evidence.
    const model = run.process?.configuration.model;
    if (
      model &&
      typeof model === "object" &&
      "providerID" in model &&
      typeof model.providerID === "string" &&
      "id" in model &&
      typeof model.id === "string"
    ) {
      return { provider: model.providerID, model: model.id };
    }
    if (typeof model === "string" && model.includes("/")) {
      const separator = model.indexOf("/");

      return {
        provider: model.slice(0, separator),
        model: model.slice(separator + 1),
      };
    }
    return undefined;
  }

  record(run: Run, kind: string, text: string) {
    run.history.push({
      at: this.now(),
      kind,
      text: this.clean(text, 4096).text,
    });
  }

  /** Record a confirmed comment once, retaining its full sanitized body for the Dashboard. */
  recordIssueComment(
    run: Run,
    comment: Pick<IssueComment, "id" | "url" | "body">,
  ) {
    if (run.history.some((entry) => entry.comment?.id === comment.id)) {
      return;
    }
    run.history.push({
      at: this.now(),
      kind: "issue-comment",
      text: "Comentario enviado a GitHub",
      comment: sanitizedRecord(
        { id: comment.id, url: comment.url, body: comment.body },
        this.clean,
      ),
    });
  }

  persist(run: Run) {
    try {
      this.store.save(run);
    } catch (error) {
      this.fault =
        "Falló la persistencia y se bloquearon nuevos efectos. Detén manualmente el proceso propio con el PID registrado.";

      throw error;
    }
  }

  assertWritable() {
    if (this.store.failed || this.fault) {
      throw new Error(
        "La persistencia no está disponible; se bloquearon los efectos",
      );
    }
  }

  assertRunning(id: string) {
    this.assertWritable();
    if (
      this.stopping.has(id) ||
      this.active !== id ||
      this.view(id)?.status === "stopped"
    ) {
      throw new Error(
        "Ejecución stopped while effect was in flight; no further task will be sent",
      );
    }
  }

  enqueue(task: string, request?: AuthorizedIssue) {
    this.assertWritable();
    if (!request && !task.trim()) {
      throw new Error("Task required");
    }
    const run: Run = {
      id: randomUUID(),
      attempt: 1,
      task: this.clean(task, Number.MAX_SAFE_INTEGER).text,
      ...(request ? { request } : {}),
      ...(!request ? { runtime: this.agentConfiguration() } : {}),
      status: "queued",
      startedAt: this.now(),
      endedAt: null,
      sessionId: null,
      process: null,
      lastObservation: null,
      lastActivity: null,
      agentStatus: null,
      error: null,
      result: null,
      pending: [],
      parts: [],
      usage: [],
      history: [],
      gaps: [
        "Only selected SDK fields retained; authentication, reasoning and arbitrary metadata omitted",
      ],
    };
    this.record(run, "admitted", "Fixed request admitted to queue");
    this.persist(run);

    return run;
  }

  private agentConfiguration() {
    return {
      provider: this.config.provider,
      model: this.config.model,
      ...(this.config.reasoningEffort !== undefined
        ? { reasoningEffort: this.config.reasoningEffort }
        : {}),
      auth: this.config.auth,
      ...(this.config.opencodeCli
        ? { opencodeCli: this.config.opencodeCli }
        : {}),
    };
  }

  async run(task: string) {
    if (this.active) {
      throw new Error("One Ejecución already occupies the Factory");
    }
    return this.start(this.enqueue(task).id);
  }

  async start(
    id: string,
    prepare?: (
      run: Run,
    ) => Promise<{ workspace: Workspace; task: string; agent: AgentPort }>,
  ) {
    this.assertWritable();
    if (this.stopping.has(id)) {
      throw new Error(
        "Ejecución interrupted while starting; no further task will be sent",
      );
    }
    if (this.active) {
      throw new Error("One Ejecución already occupies the Factory");
    }
    const run = this.view(id);
    if (!run || run.status !== "queued") {
      throw new Error("Queued request required");
    }
    if (!run.phase) {
      if (run.request) {
        run.request.runtime = this.agentConfiguration();
      } else {
        run.runtime = this.agentConfiguration();
      }
      if (this.config.tokenPrices) {
        run.tokenPrices = { ...this.config.tokenPrices };
      }
    }
    this.active = run.id;
    run.status = prepare ? "preparing" : "starting";
    run.phase = prepare ? "preparation" : "implementation";
    this.record(
      run,
      "intent",
      prepare
        ? "Prepare owned clone and verify base"
        : "Start owned OpenCode server",
    );
    this.persist(run);
    try {
      let task = run.task;
      if (prepare) {
        const prepared = await prepare(run);
        this.assertRunning(run.id);
        Object.assign(run, this.view(run.id));
        run.workspace = prepared.workspace;
        task = prepared.task;
        this.agent = prepared.agent;
        run.phase = "implementation";
        run.status = "starting";
        this.record(
          run,
          "confirmed",
          "Base checks passed; owned workspace prepared",
        );
        this.record(run, "intent", "Start owned OpenCode server");
        this.persist(run);
      }
      const process = await this.agent.start(
        (fact) => this.ingest(run.id, fact),
        (secrets) => {
          this.secrets.push(...secrets);
          this.clean = sanitizer(this.secrets);
        },
      );
      this.assertRunning(run.id);
      Object.assign(run, this.view(run.id));
      run.process = sanitizedRecord(process, this.clean);
      this.record(run, "confirmed", "Owned OpenCode server started");
      this.record(run, "intent", "Create OpenCode session");
      this.persist(run);
      run.sessionId = await this.agent.create();
      this.assertRunning(run.id);
      this.record(run, "confirmed", "OpenCode session created");
      run.status = "running";
      this.record(run, "intent", "Send task once; no automatic retry");
      this.persist(run);
      await this.agent.send(run.sessionId, task);
      this.assertRunning(run.id);
      const sent = this.view(run.id)!;
      this.record(sent, "confirmed", "Task delivered to OpenCode");
      this.persist(sent);
    } catch (error) {
      if (this.store.failed) {
        throw error;
      }
      if (this.view(run.id)?.status !== "stopped") {
        this.ingest(run.id, {
          type: "error",
          text: `No se pudo confirmar el efecto: ${String(error)}`,
        });
      }
    }
    return this.view(run.id)!;
  }

  ingest(id: string, fact: Fact, outputLimit = 65_536) {
    this.assertWritable();
    const run = this.view(id);
    if (!run || run.status === "stopped" || run.status === "completed") {
      return;
    }
    // Las observaciones tardías del agente no pueden devolver a edición un Commit candidato verificado de forma independiente.
    if (
      (run.phase === "verification" || run.phase === "publication") &&
      fact.type !== "part" &&
      fact.type !== "usage" &&
      fact.type !== "gap"
    ) {
      return;
    }
    const at = this.now();
    const text = "text" in fact ? this.clean(fact.text, outputLimit) : null;
    if (fact.type === "status" && run.agentStatus !== fact.status) {
      run.agentStatus = this.clean(fact.status, 100).text;
      run.lastActivity = at;
      this.record(run, "opencode-status", run.agentStatus);
    } else if (fact.type === "part") {
      const previous = run.parts.find((p) => p.id === fact.id);
      if (this.output(id, fact.id) !== text!.text) {
        try {
          this.store.write(id, fact.id, text!.text);
        } catch (error) {
          this.fault =
            "Falló el guardado de artefactos; se bloquearon los efectos";
          throw error;
        }
        const part = {
          id: fact.id,
          messageId: fact.messageId,
          kind: this.clean(fact.kind, 100).text,
          label: this.clean(fact.label ?? fact.kind, 200).text,
          updatedAt: at,
          truncated: text!.truncated,
        };
        const labelChanged = previous && previous.label !== part.label;
        if (previous) {
          Object.assign(previous, part);
        } else {
          run.parts.push(part);
        }
        run.lastActivity = at;
        if (!previous || labelChanged) {
          this.record(run, "part", `${part.kind}: ${part.label}`);
        }
      }
    } else if (fact.type === "usage") {
      const safe = {
        ...fact.usage,
        provider: this.clean(fact.usage.provider, 200).text,
        model: this.clean(fact.usage.model, 200).text,
      };
      const index = run.usage.findIndex((u) => u.id === safe.id);
      if (index < 0) {
        run.usage.push(safe);
      } else if (!run.usage[index].completed || safe.completed) {
        run.usage[index] = safe;
      }
    } else if (fact.type === "pending") {
      const pending = fact.pending.map((p) => ({
        id: p.id,
        kind: p.kind,
        text: this.clean(p.text, 4096).text,
      }));
      const intervention =
        run.status === "waiting"
          ? pendingIntervention(run.interventions)
          : null;
      if (intervention) {
        pending.push({
          id: intervention.id,
          kind: "question",
          text: intervention.questions,
        });
      }
      if (JSON.stringify(run.pending) !== JSON.stringify(pending)) {
        run.pending = pending;
        run.lastActivity = at;
        if (pending.length && run.status !== "intervention") {
          run.status = "waiting";
        } else if (
          run.status === "waiting" &&
          !pendingIntervention(run.interventions)
        ) {
          run.status = "running";
        }
        this.record(
          run,
          "pending",
          pending.length
            ? pending.map((p) => `${p.kind}: ${p.text}`).join("\n")
            : "No pending requests",
        );
      }
    } else if (fact.type === "finished" && run.status !== "intervention") {
      if (fact.messageId && fact.messageId === run.lastFinishedMessageId) {
        return;
      }
      run.lastFinishedMessageId = fact.messageId;
      let questions: string | null;
      try {
        questions = run.request ? interventionQuestions(text!.text) : null;
      } catch (error) {
        run.status = "intervention";
        run.error = String(error);
        this.record(run, "error", run.error);
        this.persist(run);
        return;
      }
      if (questions) {
        const previous = pendingIntervention(run.interventions);
        if (previous && !previous.response) {
          return;
        }
        const intervention = {
          id: fact.messageId ?? randomUUID(),
          questions,
          requestedAt: at,
        };
        (run.interventions ??= []).push(intervention);
        run.pending = [
          { id: intervention.id, kind: "question", text: questions },
        ];
        run.status = "waiting";
        run.result = null;
        run.endedAt = null;
        this.record(run, "agent-intervention", questions);
        this.persist(run);
        return;
      }
      const delivery = agentDelivery(text!.text);
      run.result = delivery.description;
      run.attemptSummary = delivery.summary;
      run.status = "awaiting_verification";
      if (!run.endedAt) {
        run.endedAt = at;
        this.record(
          run,
          "result",
          "Agent finished. Result unverified; no acceptance or publication accredited.",
        );
      }
    } else if (fact.type === "error") {
      run.error = text!.text;
      run.status = "intervention";
      this.record(run, "error", text!.text);
    } else if (fact.type === "gap") {
      if (!run.gaps.includes(text!.text)) {
        run.gaps.push(text!.text);
        this.record(run, "gap", text!.text);
      }
    } else if (fact.type === "process-exit") {
      if (run.process) {
        run.process.exited = true;
      }
      run.status = "intervention";
      run.error = this.clean(fact.detail).text;
      this.record(run, "process-exit", run.error);
    }
    if (fact.type === "observed") {
      run.lastObservation = at;
    }
    if (fact.type === "process-started") {
      run.process = {
        pid: fact.pid,
        version: "unconfirmed",
        configuration: { omissions: "Startup configuration not yet observed" },
      };
      this.record(
        run,
        "process-started",
        `Owned OpenCode PID ${fact.pid}; version/configuration awaiting observation`,
      );
    }
    this.persist(run);
    if (fact.type === "finished" && run.status === "awaiting_verification") {
      this.onCandidateReady?.();
    }
  }

  async stop(id: string) {
    this.assertWritable();
    const run = this.view(id);
    if (!run || this.active !== id) {
      throw new Error("Ejecución is not active");
    }
    this.stopping.add(id);
    this.record(run, "intent", "Abort session and stop owned process group");
    this.persist(run);
    let result;
    try {
      result =
        (run.request && !run.process) || run.process?.exited
          ? {
              exited: true,
              detail: "Owned agent was already confirmed absent",
            }
          : await this.agent.stop(run.sessionId);
    } catch (error) {
      result = {
        exited: false,
        detail: `No se pudo confirmar la detención: ${String(error)}`,
      };
    }
    const latest = this.view(id)!;
    latest.status = result.exited ? "stopped" : "intervention";
    latest.endedAt ??= this.now();
    if (latest.process) {
      latest.process.exited = result.exited;
    }
    latest.pending = [];

    this.record(latest, "stop", result.detail);
    this.persist(latest);
    if (result.exited) {
      this.active = null;
    } else {
      this.stopping.delete(id);
    }
    return latest;
  }

  async restoreConversation(id: string, agent: AgentPort) {
    this.assertRunning(id);
    const run = this.view(id)!;
    if (!run.sessionId || !["waiting", "intervention"].includes(run.status)) {
      throw new Error(
        "A waiting or interrupted agent conversation is required",
      );
    }
    this.record(
      run,
      "intent",
      `Recover owned OpenCode server for thread ${run.sessionId}`,
    );
    this.persist(run);
    this.agent = agent;
    const process = await agent.start(
      (fact) => this.ingest(id, fact),
      (secrets) => {
        this.secrets.push(...secrets);
        this.clean = sanitizer(this.secrets);
      },
    );
    this.assertRunning(id);
    const current = this.view(id)!;
    current.process = sanitizedRecord(process, this.clean);
    this.record(
      current,
      "conversation-restored",
      `Observe existing agent thread ${run.sessionId}`,
    );
    this.persist(current);
    await agent.resume(run.sessionId);
    this.assertRunning(id);
  }

  async suspendConversation(id: string) {
    this.assertRunning(id);
    const run = this.view(id)!;
    this.record(
      run,
      "intent",
      "Stop owned OpenCode server and preserve the Ejecución and conversation",
    );
    this.persist(run);
    this.stopping.add(id);
    let stopped;
    try {
      stopped =
        (run.request && !run.process) || run.process?.exited
          ? { exited: true, detail: "Owned agent was already confirmed absent" }
          : await this.agent.stop(run.sessionId);
    } catch (error) {
      stopped = {
        exited: false,
        detail: `No se pudo confirmar la detención: ${String(error)}`,
      };
    }
    this.assertWritable();
    const current = this.view(id)!;
    if (current.process) {
      current.process.exited = stopped.exited;
    }
    if (
      !stopped.exited ||
      current.status !== "waiting" ||
      !pendingIntervention(current.interventions)
    ) {
      current.status = "intervention";
      current.error = !stopped.exited
        ? this.clean(stopped.detail).text
        : (current.error ??
          "La Factory se apagó. La Ejecución sigue pendiente; usa Reintentar para continuar.");
    }
    current.endedAt = null;
    this.record(current, "conversation-suspended", stopped.detail);
    this.persist(current);
  }

  view(id: string) {
    return this.store.list().find((r) => r.id === id) ?? null;
  }

  list() {
    return this.store.list();
  }

  output(id: string, partId: string) {
    return this.store.output(id, partId);
  }

  close() {
    this.store.close();
  }
}
