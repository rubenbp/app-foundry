import type { Workspace, ManagedProject } from "../domain/request.ts";
import type { Verification } from "../domain/verification.ts";

export type VerificationProgress = (
  report: Verification,
  output?: { id: string; label: string; text: string },
) => void;

export interface CandidateVerification {
  verify(
    workspace: Workspace,
    project: ManagedProject,
    report: Verification,
    progress: VerificationProgress,
    signal: AbortSignal,
  ): Promise<void>;
}
