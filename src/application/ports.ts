import type {
  ManagedProject,
  ReadyIssue,
  Workspace,
} from "../domain/request.ts";
import type { IssueLabel } from "../domain/issueLabels.ts";

export interface GitHubPort {
  ready(repository: string): Promise<ReadyIssue[]>;
  // Conciliar antes de escribir permite repetir una actualización sin perder etiquetas ajenas.
  setRunLabel(
    repository: string,
    issue: number,
    label: IssueLabel,
  ): Promise<void>;
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
