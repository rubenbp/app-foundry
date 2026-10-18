import type { AuthorizedIssue, Workspace } from "./request.ts";
import type { Verification } from "./verification.ts";
import type { Publication } from "./publication.ts";
import type { AgentIntervention } from "./intervention.ts";
export type RunStatus =
  | "queued"
  | "preparing"
  | "starting"
  | "running"
  | "waiting"
  | "awaiting_verification"
  | "verifying"
  | "awaiting_preview"
  | "awaiting_review"
  | "awaiting_merge"
  | "closing_issue"
  | "completed"
  | "intervention"
  | "stopped";
export interface History {
  at: number;
  kind: string;
  text: string;
}
export interface PartView {
  id: string;
  messageId: string;
  kind: string;
  label: string;
  updatedAt: number;
  truncated: boolean;
}
export interface Usage {
  id: string;
  provider: string;
  model: string;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  } | null;
  sdkCost: number | null;
  completed: boolean;
}
export interface Pending {
  id: string;
  kind: "permission" | "question";
  text: string;
}
export interface Run {
  id: string;
  attempt: number;
  task: string;
  request?: AuthorizedIssue;
  workspace?: Workspace;
  verification?: Verification;
  publication?: Publication;
  phase?: "preparation" | "implementation" | "verification" | "publication";
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  sessionId: string | null;
  process: {
    pid: number;
    version: string;
    configuration: Record<string, unknown>;
    exited?: boolean;
  } | null;
  lastObservation: number | null;
  lastActivity: number | null;
  agentStatus: string | null;
  error: string | null;
  result: string | null;
  pending: Pending[];
  interventions?: AgentIntervention[];
  lastFinishedMessageId?: string;
  parts: PartView[];
  usage: Usage[];
  history: History[];
  gaps: string[];
}
export function consumption(usage: Usage[]) {
  const withTokens = usage.filter((u) => u.tokens !== null);
  const observed = withTokens.length
    ? withTokens.reduce(
        (sum, u) =>
          sum +
          u.tokens!.input +
          u.tokens!.output +
          u.tokens!.reasoning +
          u.tokens!.cacheRead +
          u.tokens!.cacheWrite,
        0,
      )
    : null;
  const priced = usage.filter(
    (u) => u.completed && u.sdkCost !== null && u.sdkCost > 0,
  );

  return {
    observedTokens: observed,
    estimatedCost: priced.length
      ? priced.reduce((sum, u) => sum + u.sdkCost!, 0)
      : null,
    apiEquivalent: null,
    accreditedSpend: null,
    source: "OpenCode HTTP SDK 2.0.32 / assistant message identity",
    currency: "USD",
    modality: "OpenCode OAuth / subscription; no invoice attribution",
    coverage:
      usage.length &&
      withTokens.length === usage.length &&
      usage.every((u) => u.completed)
        ? "observed messages; provider completeness unverified"
        : "partial / unavailable",
    tariff: "OpenCode effective catalog; tariff version unavailable",
  };
}
