import { sanitizedRecord } from "./sanitize.ts";
import { queuedRuns } from "../domain/queue.ts";
import type { Factory } from "./factory.ts";
import { validateProject } from "../domain/configuration.ts";
import type {
  Effect,
  GitHubPort,
  WorkspacePort,
  WorkflowOwnership,
} from "./ports.ts";
import { requestContext, pullRequestInstructions } from "./agentTask.ts";
import { captureIssue } from "../domain/request.ts";
import type { ReadyIssue } from "../domain/request.ts";
import type { AgentPort } from "./agent.ts";
import type { FactoryConfig } from "./configuration.ts";
import { verificationPlan } from "../domain/verification.ts";
import type { CandidateVerification } from "./verification.ts";
import { CandidatePublication } from "./candidatePublication.ts";
import type { PublicationPort } from "./publication/ports.ts";
import type { IssueConversation } from "./issueConversation.ts";
import { IssueInterventions } from "./issueInterventions.ts";
import { pendingIntervention } from "../domain/intervention.ts";
import type { RecoveryCommand } from "../domain/recovery.ts";
import { IssueRecovery } from "./issueRecovery.ts";
import type { Run } from "../domain/run.ts";
import { issueLabel } from "../domain/issueLabels.ts";

export interface WorkflowOptions {
  createAgent: (config: FactoryConfig) => AgentPort;
  workspace?: WorkspacePort;
  github?: GitHubPort;
  verifier: CandidateVerification;
  createFactory: (
    config: FactoryConfig,
    agent: AgentPort,
    reservedRun?: string,
  ) => Factory;
  publication?: PublicationPort;
  issueConversation?: IssueConversation;
  acquireOwnership: (config: FactoryConfig) => WorkflowOwnership;
}

export class Workflow {
  readonly factory: Factory;
  private github?: GitHubPort;
  private polling = false;
  private workspace?: WorkspacePort;
  private createAgent: (config: FactoryConfig) => AgentPort;
  private ownership: WorkflowOwnership;
  private closed = false;
  private verifying = false;
  private verificationAbort?: AbortController;
  private verificationDone?: Promise<void>;
  private verifier: CandidateVerification;
  private publication?: CandidatePublication;
  private interventions?: IssueInterventions;
  private recovery?: IssueRecovery;
  private conversationAttached = true;
  private labelsBusy?: Promise<void>;

  get observation() {
    return this.factory.store.observation();
  }

  constructor(config: FactoryConfig, options: WorkflowOptions) {
    this.github = options.github;
    this.workspace = options.workspace;
    this.createAgent = options.createAgent;
    this.verifier = options.verifier;
    if (!config.managedProject) {
      throw new Error("Trusted Managed project configuration required");
    }
    validateProject(config.managedProject);
    this.ownership = options.acquireOwnership(config);
    try {
      this.factory = options.createFactory(
        config,
        options.createAgent(config),
        this.ownership.reservation() ?? undefined,
      );
      this.conversationAttached =
        this.factory.view(this.factory.active ?? "")?.status !== "waiting";
      if (options.issueConversation) {
        this.recovery = new IssueRecovery(
          this.factory,
          options.issueConversation,
          (id, command) =>
            this.recover(id, command, options.issueConversation!),
        );
        this.interventions = new IssueInterventions(
          this.factory,
          options.issueConversation,
          () => this.restoreConversation(),
        );
      }
      if (options.publication) {
        this.publication = new CandidatePublication(
          this.factory,
          options.publication,
        );
      }
      const reserved = this.ownership.reservation();
      if (!reserved && this.factory.active) {
        this.ownership.reserve(this.factory.active);
      }
      if (reserved) {
        const run = this.view(reserved);
        if (!run) {
          throw new Error(
            "No se encontró la Ejecución reservada en esta carpeta de datos; comprueba manualmente quién la controla",
          );
        }
        if (run.status === "stopped" || run.status === "completed") {
          this.ownership.releaseRun(reserved);
        } else if (run.status === "queued") {
          run.status = "intervention";
          run.phase = "preparation";
          run.error =
            "La preparación quedó reservada antes del reinicio; comprueba los efectos antes de recuperar. No se reenvió la tarea.";
          this.factory.active = run.id;
          this.factory.record(run, "recovery", run.error);
          this.factory.persist(run);
        }
      }
    } catch (error) {
      this.ownership.close();
      throw error;
    }
  }

  private halted = false;

  halt() {
    this.halted = true;
  }

  async poll() {
    if (this.polling || this.halted) {
      return;
    }
    if (!this.github) {
      throw new Error("GitHub adapter required");
    }
    this.polling = true;
    try {
      await this.recovery?.notify();
      await this.recovery?.poll();
      await this.interventions?.poll();
      if (this.halted) {
        return;
      }
      await this.verifyCandidate();
      const publishing = this.factory.active;
      await this.publication?.poll();
      if (publishing && this.view(publishing)?.status === "completed") {
        this.ownership.releaseRun(publishing);
      }
      const issues = await this.github.ready(
        this.factory.config.managedProject!.repository,
      );
      if (this.halted) {
        return;
      }
      await this.observe(issues);
      await this.startNext();
      const current = this.view(this.factory.active ?? "");
      if (current?.recovery?.notice && current.status !== "intervention") {
        delete current.recovery.notice;
        this.factory.persist(current);
      }
      await this.recovery?.notify();
      await this.syncIssueLabels();
    } catch (error) {
      this.factory.assertWritable();
      this.factory.store.observation({
        at: this.factory.now(),
        error: this.factory.clean(
          `Falló la observación de GitHub o del workflow: ${String(error)}`,
        ).text,
      });
    } finally {
      this.polling = false;
    }
  }

  async observe(issues: ReadyIssue[]) {
    const observedAt = this.factory.now();
    const errors: string[] = [];
    for (const issue of issues) {
      if (
        this.factory
          .list()
          .some(
            (r) =>
              r.request?.repository === issue.repository &&
              r.request.number === issue.number,
          )
      ) {
        continue;
      }
      try {
        const request = captureIssue(
          issue,
          this.factory.config.managedProject!,
          observedAt,
          {
            provider: this.factory.config.provider,
            model: this.factory.config.model,
            auth: this.factory.config.auth,
            ...(this.factory.config.opencodeCli
              ? { opencodeCli: this.factory.config.opencodeCli }
              : {}),
          },
        );
        const safe = sanitizedRecord(request, this.factory.clean);
        this.factory.enqueue(safe.body, safe);
      } catch (error) {
        this.factory.assertWritable();
        errors.push(`${issue.url}: ${String(error)}`);
      }
    }
    this.factory.store.observation({
      at: this.factory.now(),
      error: errors.length ? this.factory.clean(errors.join("\n")).text : null,
    });
    await this.syncIssueLabels();
  }

  // Proyecta el estado existente. Un fallo conserva la intención y usa el error de observación
  // del workflow; la siguiente consulta concilia el mismo efecto sin repetir el desarrollo.
  async syncIssueLabels(): Promise<void> {
    if (!this.github || this.halted) {
      return;
    }
    if (this.labelsBusy) {
      await this.labelsBusy;
      return this.syncIssueLabels();
    }
    this.labelsBusy = this.updateIssueLabels().finally(() => {
      this.labelsBusy = undefined;
    });
    return this.labelsBusy;
  }

  private async updateIssueLabels() {
    for (const snapshot of this.list()) {
      const run = this.view(snapshot.id)!;
      if (!run.request || this.halted) {
        continue;
      }
      const name = issueLabel(run.status);
      if (
        run.issueLabel?.name === name &&
        run.issueLabel.state === "confirmed"
      ) {
        continue;
      }
      this.factory.assertWritable();
      run.issueLabel = { name, state: "intent" };
      this.factory.record(run, "intent", `Issue label: ${name}`);
      this.factory.persist(run);
      await this.github!.setRunLabel(
        run.request.repository,
        run.request.number,
        name,
      );
      this.factory.assertWritable();
      const current = this.view(run.id)!;
      current.issueLabel = { name, state: "confirmed" };
      this.factory.record(current, "confirmed", `Issue label: ${name}`);
      this.factory.persist(current);
    }
  }

  async startNext() {
    if (this.halted || this.factory.active) {
      return null;
    }
    const next = this.queue()[0];
    if (!next) {
      return null;
    }
    if (!this.workspace) {
      throw new Error("Workspace preparation adapter required");
    }
    this.ownership.reserve(next.id);
    return this.startPrepared(next.id);
  }

  private startPrepared(id: string, retry = false) {
    return this.factory.start(id, async (run) => {
      await this.syncIssueLabels();
      const effect: Effect = async (id, description, action) => {
        this.factory.assertRunning(run.id);
        const before = this.view(run.id)!;
        this.factory.record(before, "intent", description);
        this.factory.persist(before);
        const result = await action();
        this.factory.assertRunning(run.id);
        this.factory.ingest(run.id, {
          type: "part",
          id,
          messageId: "preparation",
          kind: "evidence",
          label: result.label,
          text: result.output,
        });
        const after = this.view(run.id)!;
        if (result.workspace) {
          after.workspace = sanitizedRecord(
            result.workspace,
            this.factory.clean,
          );
        }
        this.factory.record(after, "confirmed", description);
        this.factory.persist(after);
        return result;
      };
      const prepared = await this.workspace!.prepare(
        run.id,
        run.request!.configuration,
        effect,
        retry,
      );
      await this.workspace!.validate(prepared, run.request!.configuration);
      const workspace = sanitizedRecord(prepared, this.factory.clean);

      return {
        workspace,
        task: requestContext(run.request!, workspace),
        agent: this.createAgent({
          ...this.factory.config,
          projectDir: workspace.directory,
          managedProject: run.request!.configuration,
          conversationId: run.id,
        }),
      };
    });
  }

  private async stopEditing(run: Run) {
    if (!run.process || run.process.exited) {
      return;
    }
    const stopped = await this.factory.agent.stop(run.sessionId);
    this.factory.assertRunning(run.id);
    const current = this.view(run.id)!;
    current.process!.exited = stopped.exited;
    this.factory.record(current, "agent-stop", stopped.detail);
    this.factory.persist(current);
    if (!stopped.exited) {
      throw new Error(stopped.detail);
    }
    this.conversationAttached = false;
  }

  private async recover(
    id: string,
    command: RecoveryCommand,
    conversation: IssueConversation,
  ) {
    let run = this.view(id)!;
    const merged = await this.publication?.isMerged(id);
    if (merged && command.kind !== "retry") {
      return "El cambio ya está integrado. Solo se puede reintentar el resumen y el cierre; para cambios adicionales, crea otro issue.";
    }
    if (command.kind === "cancel") {
      const stopped = await this.stop(id);
      if (stopped.status !== "stopped") {
        throw new Error(
          "La parada no está confirmada; el issue sigue abierto.",
        );
      }
      await conversation.close(run.request!.repository, run.request!.number);
      return "Ejecución cancelada. El issue se ha cerrado como no implementado.";
    }
    if (run.verification?.effectsUncertain) {
      throw new Error(
        "La parada de los comandos requiere inspección local antes de continuar.",
      );
    }
    if (command.kind === "retry" && (merged || run.phase === "publication")) {
      await this.publication!.retry(id);
      return "Reintento de publicación solicitado; la Factory comprobará los efectos existentes y continuará el paso pendiente.";
    }
    await this.publication?.invalidate(id);
    await this.stopEditing(this.view(id)!);
    run = this.view(id)!;
    const cause = run.error;
    run.error = null;
    run.endedAt = null;
    run.pending = [];
    if (command.kind === "retry" && run.phase === "verification") {
      run.status = "awaiting_verification";
      this.factory.persist(run);
      return "Se repetirá la verificación completa del Commit candidato.";
    }
    if (run.phase === "preparation" || !run.sessionId) {
      run.status = "queued";
      this.factory.persist(run);
      this.factory.active = null;
      await this.startPrepared(id, true);
      return "Preparación reintentada sobre el mismo puesto de trabajo.";
    }
    run.status = "intervention";
    run.phase = "implementation";
    delete run.verification;
    run.result = null;
    run.attempt++;
    for (const intervention of run.interventions ?? []) {
      if (!intervention.deliveredAt) {
        intervention.supersededAt = this.factory.now();
      }
    }
    this.factory.persist(run);
    await this.workspace!.validate(run.workspace!, run.request!.configuration);
    const agent = this.createAgent({
      ...this.factory.config,
      projectDir: run.workspace!.directory,
      managedProject: run.request!.configuration,
      conversationId: run.id,
    });
    await this.factory.restoreConversation(id, agent);
    this.conversationAttached = true;
    run = this.view(id)!;
    run.status = "running";
    this.factory.record(
      run,
      "attempt-started",
      `Explicit ${command.kind}; attempt ${run.attempt}; same thread and branch`,
    );
    this.factory.persist(run);
    const instructions =
      command.kind === "correct"
        ? command.instructions
        : `Reintenta el trabajo pendiente tras este fallo: ${cause ?? "Intento interrumpido"}.`;
    await this.factory.agent.send(
      run.sessionId!,
      `Continúa el mismo encargo y conserva el trabajo acumulado.\n\n${instructions}\n\n${pullRequestInstructions}`,
    );
    this.factory.assertRunning(id);
    return `Intento ${run.attempt} iniciado en la misma conversación y rama. El resultado necesitará verificación y una nueva aceptación.`;
  }

  queue() {
    return queuedRuns(this.list());
  }

  private async restoreConversation() {
    if (this.conversationAttached) {
      return;
    }
    const run = this.view(this.factory.active!)!;
    if (!this.workspace) {
      throw new Error("Workspace adapter required to restore the conversation");
    }
    await this.workspace.validate(run.workspace!, run.request!.configuration);
    const agent = this.createAgent({
      ...this.factory.config,
      projectDir: run.workspace!.directory,
      managedProject: run.request!.configuration,
      conversationId: run.id,
    });
    await this.factory.restoreConversation(run.id, agent);
    this.conversationAttached = true;
  }

  async shutdown() {
    this.halt();
    const run = this.view(this.factory.active ?? "");
    if (!run) {
      return;
    }
    if (run.status === "waiting" && pendingIntervention(run.interventions)) {
      if (this.conversationAttached) {
        await this.factory.suspendConversation(run.id);
        this.conversationAttached = false;
      }
      return;
    }
    await this.stop(run.id);
  }

  async verifyCandidate() {
    const id = this.factory.active;
    const run = id ? this.view(id) : null;
    if (
      this.halted ||
      this.verifying ||
      run?.status !== "awaiting_verification"
    ) {
      return null;
    }
    this.verifying = true;
    this.verificationAbort = new AbortController();
    let done!: () => void;
    this.verificationDone = new Promise<void>((resolve) => {
      done = resolve;
    });
    try {
      this.factory.assertRunning(run.id);
      if (!run.workspace || !run.request || !this.workspace) {
        throw new Error("Prepared candidate context required");
      }
      run.phase = "verification";
      run.status = "verifying";
      run.endedAt = null;
      run.verification = verificationPlan(
        run.workspace.baseSha,
        run.request.configuration.verification.commands,
        run.request.body,
      );
      this.factory.record(
        run,
        "intent",
        "Stop agent editing before fixing candidate head",
      );
      this.factory.persist(run);
      const stopped = run.process?.exited
        ? {
            exited: true,
            detail: "Agent editing was already confirmed stopped",
          }
        : await this.factory.agent.stop(run.sessionId);
      this.factory.assertRunning(run.id);
      const latest = this.view(run.id)!;
      if (latest.process) {
        latest.process.exited = stopped.exited;
      }
      this.factory.record(latest, "agent-stop", stopped.detail);
      this.factory.persist(latest);
      if (!stopped.exited) {
        throw new Error(
          "Agent editing stop unconfirmed; candidate cannot be fixed",
        );
      }
      await this.workspace.validate(run.workspace, run.request.configuration);
      await this.verifier.verify(
        run.workspace,
        run.request.configuration,
        run.verification,
        (report, output) => {
          this.factory.assertRunning(run.id);
          if (output) {
            this.factory.ingest(
              run.id,
              {
                type: "part",
                messageId: "verification",
                kind: "evidence",
                ...output,
              },
              1_100_000,
            );
          }
          if (
            output &&
            this.view(run.id)!.parts.find((part) => part.id === output.id)
              ?.truncated
          ) {
            throw new Error(
              "Verification evidence truncated; complete evidence required before approval",
            );
          }
          const current = this.view(run.id)!;
          current.verification = sanitizedRecord(report, this.factory.clean);
          this.factory.persist(current);
        },
        this.verificationAbort.signal,
      );
      await this.workspace.validate(run.workspace, run.request.configuration);
      const completed = this.view(run.id)!;
      completed.status =
        completed.verification!.status === "passed"
          ? "awaiting_preview"
          : "intervention";
      completed.error = completed.verification!.error;
      this.factory.record(
        completed,
        "verification",
        completed.error ??
          "Las comprobaciones técnicas terminaron correctamente; falta evaluar los criterios y revisar la vista previa",
      );
      this.factory.persist(completed);
      return completed;
    } catch (error) {
      this.factory.assertWritable();
      const current = this.view(run!.id)!;
      current.status = "intervention";
      current.error = `Falló la verificación del Commit candidato. Detalle: ${this.factory.clean(String(error)).text}`;
      if (current.verification) {
        current.verification.status = "intervention";
        current.verification.error = current.error;
      }
      this.factory.record(current, "verification-error", current.error);
      this.factory.persist(current);
      return current;
    } finally {
      this.verifying = false;
      this.verificationAbort = undefined;
      done();
    }
  }

  list() {
    return this.factory.list();
  }

  view(id: string) {
    return this.factory.view(id);
  }

  output(runId: string, partId: string) {
    return this.factory.output(runId, partId);
  }

  async stop(id: string) {
    const run = this.view(id);
    if (
      run?.status === "waiting" &&
      !this.conversationAttached &&
      !run.process?.exited
    ) {
      await this.restoreConversation();
    }
    await this.publication?.stop(id);
    if (this.verifying && this.factory.active === id) {
      const run = this.view(id)!;
      this.factory.record(
        run,
        "intent",
        "Cancel verification and stop its owned command group",
      );
      this.factory.persist(run);
      this.verificationAbort?.abort(
        new Error("Verification cancelled; command completion is not approved"),
      );
      await this.verificationDone;
    }
    if (this.view(id)?.verification?.effectsUncertain) {
      return this.view(id)!;
    }
    const result = await this.factory.stop(id);
    if (result.status === "stopped") {
      this.ownership.releaseRun(id);
    }
    await this.syncIssueLabels();
    return result;
  }

  close() {
    if (this.closed) {
      return;
    }
    this.halt();
    const reserved = this.ownership.reservation();
    if (
      reserved &&
      ["stopped", "completed"].includes(this.view(reserved)?.status ?? "")
    ) {
      this.ownership.releaseRun(reserved);
    }
    this.factory.close();
    this.ownership.close();
    this.closed = true;
  }
}
