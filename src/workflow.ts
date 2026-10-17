import { Workflow } from "./application/workflow.ts";
import type { WorkflowOptions } from "./application/workflow.ts";
import type { FactoryConfig } from "./types.ts";
import { acquireWorkflowOwnership } from "./infrastructure/ownership.ts";

// Public composition root. Tests retain real ownership, SQLite and artifacts.
export function createWorkflow(
  config: FactoryConfig,
  options: Omit<WorkflowOptions, "acquireOwnership">,
) {
  return new Workflow(config, {
    ...options,
    acquireOwnership: acquireWorkflowOwnership,
  });
}
