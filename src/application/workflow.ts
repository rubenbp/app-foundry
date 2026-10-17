import { sanitizedRecord } from "../sanitize.ts";
import { queuedRuns } from "../domain/queue.ts";
import { Factory } from "../factory.ts";
import { validateProject } from "../domain/configuration.ts";
import type {
  Effect,
  GitHubPort,
  WorkspacePort,
  WorkflowOwnership,
} from "./ports.ts";
import { requestContext } from "./agent-task.ts";
import { authorize } from "../domain/request.ts";
import type { ReadyIssue } from "../domain/request.ts";
import type { AgentPort, FactoryConfig } from "../types.ts";

export interface WorkflowOptions {
  createAgent: (config: FactoryConfig) => AgentPort;
  workspace?: WorkspacePort;
  github?: GitHubPort;
  secrets?: string[];
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
  get observation() {
    return this.factory.store.observation();
  }
  constructor(config: FactoryConfig, options: WorkflowOptions) {
    this.github = options.github;
    this.workspace = options.workspace;
    this.createAgent = options.createAgent;
    if (!config.managedProject)
      throw new Error("Trusted Managed project configuration required");
    validateProject(config.managedProject);
    this.ownership = options.acquireOwnership(config);
    try {
      this.factory = new Factory(config, options.createAgent(config), {
        secrets: options.secrets,
      });
      const reserved = this.ownership.reservation();
      if (!reserved && this.factory.active)
        this.ownership.reserve(this.factory.active);
      if (reserved) {
        const run = this.view(reserved);
        if (!run)
          throw new Error(
            "Reserved Ejecución missing from this data root; inspect ownership manually",
          );
        if (run.status === "stopped") this.ownership.releaseRun(reserved);
        else if (run.status === "queued") {
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
    if (this.polling || this.halted) return;
    if (!this.github) throw new Error("GitHub adapter required");
    this.polling = true;
    try {
      const issues = await this.github.ready(
        this.factory.config.managedProject!.repository,
      );
      if (this.halted) return;
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
      )
        continue;
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
    if (this.halted || this.factory.active) return null;
    const next = this.queue()[0];
    if (!next) return null;
    if (!this.workspace)
      throw new Error("Workspace preparation adapter required");
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
        if (result.workspace)
          after.workspace = sanitizedRecord(
            result.workspace,
            this.factory.clean,
          );
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
    const result = await this.factory.stop(id);
    if (result.status === "stopped") this.ownership.releaseRun(id);
    return result;
  }
  close() {
    if (this.closed) return;
    this.halt();
    const reserved = this.ownership.reservation();
    if (reserved && this.view(reserved)?.status === "stopped")
      this.ownership.releaseRun(reserved);
    this.factory.close();
    this.ownership.close();
    this.closed = true;
  }
}
