import { Workflow } from "../application/workflow.ts";
import type { WorkflowOptions } from "../application/workflow.ts";
import type { FactoryConfig } from "../application/configuration.ts";
import { acquireWorkflowOwnership } from "../infrastructure/ownership.ts";

import { createFactory } from "./factory.ts";
import { CandidateVerifier } from "../infrastructure/verification.ts";
import type { ProcessPort } from "../infrastructure/process.ts";

export type ComposedWorkflowOptions = Omit<
  WorkflowOptions,
  "acquireOwnership" | "createFactory" | "verifier"
> & {
  secrets?: string[];
  verificationProcess?: ProcessPort;
};

// Public composition root. Tests retain real ownership, SQLite and artifacts.
export function createWorkflow(
  config: FactoryConfig,
  options: ComposedWorkflowOptions,
) {
  return new Workflow(config, {
    ...options,
    acquireOwnership: acquireWorkflowOwnership,
    createFactory: (config, agent) =>
      createFactory(config, agent, { secrets: options.secrets }),
    verifier: new CandidateVerifier(
      config.dataDir,
      options.verificationProcess,
    ),
  });
}
