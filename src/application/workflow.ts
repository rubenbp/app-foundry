import { sanitizedRecord } from "../sanitize.ts";
import { queuedRuns } from "../domain/queue.ts";
import { Factory } from "../factory.ts";
import { validateProject } from "../domain/configuration.ts";
import type { Effect, GitHubPort, WorkspacePort } from "./ports.ts";
import { requestContext } from "../domain/request.ts";
import { authorize } from "../domain/request.ts";
import type { ReadyIssue } from "../domain/request.ts";
import type { AgentPort, FactoryConfig } from "../types.ts";

export interface WorkflowOptions {
  createAgent: (config: FactoryConfig) => AgentPort;
  workspace?: WorkspacePort;
  github?: GitHubPort;
  secrets?: string[];
  acquireOwnership: (config: FactoryConfig) => () => void;
}

export class Workflow {
  readonly factory: Factory;
  private github?: GitHubPort;
  private polling = false;
  private workspace?: WorkspacePort;
  private createAgent: (config: FactoryConfig) => AgentPort;
  private release: () => void;
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
    this.release = options.acquireOwnership(config);
    try {
      this.factory = new Factory(config, options.createAgent(config), {
        secrets: options.secrets,
      });
    } catch (error) {
      this.release();
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
        );
        const safe = sanitizedRecord(request, this.factory.clean);
        this.factory.enqueue(safe.body, safe);
      } catch (error) {
        this.factory.assertWritable();
        this.factory.store.observation({
          at: this.factory.now(),
          error: this.factory.clean(`${issue.url}: ${String(error)}`).text,
        });
        return;
      }
    }
    this.factory.store.observation({ at: this.factory.now(), error: null });
  }
  async startNext() {
    if (this.halted || this.factory.active) return null;
    const next = this.queue()[0];
    if (!next) return null;
    if (!this.workspace)
      throw new Error("Workspace preparation adapter required");
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
  close() {
    this.halt();
    this.factory.close();
    this.release();
  }
}
