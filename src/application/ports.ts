import type {
  ManagedProject,
  ReadyIssue,
  Workspace,
} from "../domain/request.ts";

export interface GitHubPort {
  ready(repository: string): Promise<ReadyIssue[]>;
}
export interface EffectEvidence {
  label: string;
  output: string;
  workspace?: Workspace;
}
export type Effect = <T extends EffectEvidence>(
  id: string,
  description: string,
  action: () => Promise<T>,
) => Promise<T>;
export interface WorkspacePort {
  prepare(
    id: string,
    project: ManagedProject,
    effect: Effect,
    retry?: boolean,
  ): Promise<Workspace>;
  validate(workspace: Workspace, project: ManagedProject): Promise<void>;
}

export interface WorkflowOwnership {
  reservation(): string | null;
  reserve(runId: string): void;
  releaseRun(runId: string): void;
  close(): void;
}
