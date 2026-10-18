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
import { requestContext } from "./agentTask.ts";
import { authorize } from "../domain/request.ts";
import type { ReadyIssue } from "../domain/request.ts";
import type { AgentPort } from "./agent.ts";
import type { FactoryConfig } from "./configuration.ts";
import { verificationPlan } from "../domain/verification.ts";
import type { CandidateVerification } from "./verification.ts";
import { CandidatePublication } from "./candidatePublication.ts";
import type { PublicationPort } from "./publication/ports.ts";

export interface WorkflowOptions {
  createAgent: (config: FactoryConfig) => AgentPort;
  workspace?: WorkspacePort;
  github?: GitHubPort;
  verifier: CandidateVerification;
  createFactory: (config: FactoryConfig, agent: AgentPort) => Factory;
  publication?: PublicationPort;
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
      this.factory = options.createFactory(config, options.createAgent(config));
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
            "Reserved Ejecución missing from this data root; inspect ownership manually",
          );
        }
        if (run.status === "stopped" || run.status === "completed") {
          this.ownership.releaseRun(reserved);
        } else if (run.status === "queued") {
          run.status = "intervention";
          run.phase = "preparation";
          run.error =
            "Preparation ownership was reserved before restart; inspect effects before recovery. No task was resent.";
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
    } catch (error) {
      this.factory.assertWritable();
      this.factory.store.observation({
        at: this.factory.now(),
        error: this.factory.clean(
          `GitHub/workflow observation failed: ${String(error)}`,
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
        const request = authorize(
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
    return this.factory.start(next.id, async (run) => {
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
      );
      await this.workspace!.validate(prepared, run.request!.configuration);
      const workspace = sanitizedRecord(prepared, this.factory.clean);

      return {
        workspace,
        task: requestContext(run.request!, workspace),
        agent: this.createAgent({
          ...this.factory.config,
          ...run.request!.runtime,
          projectDir: workspace.directory,
          managedProject: run.request!.configuration,
        }),
      };
    });
  }

  queue() {
    return queuedRuns(this.list());
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
      const stopped = await this.factory.agent.stop(run.sessionId);
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
          "Technical checks passed; criterion judgment and preview pending",
      );
      this.factory.persist(completed);
      return completed;
    } catch (error) {
      this.factory.assertWritable();
      const current = this.view(run!.id)!;
      current.status = "intervention";
      current.error = this.factory.clean(String(error)).text;
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
