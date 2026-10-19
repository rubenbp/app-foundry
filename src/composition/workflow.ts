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

// Punto público de composición. Las pruebas conservan la gestión real, SQLite y los artefactos.
export function createWorkflow(
  config: FactoryConfig,
  options: ComposedWorkflowOptions,
) {
  return new Workflow(config, {
    ...options,
    acquireOwnership: acquireWorkflowOwnership,
    createFactory: (config, agent, reservedRun) =>
      createFactory(config, agent, { secrets: options.secrets, reservedRun }),
    verifier: new CandidateVerifier(
      config.dataDir,
      options.verificationProcess,
    ),
  });
}
