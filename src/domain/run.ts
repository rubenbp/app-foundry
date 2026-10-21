import type {
  AgentConfiguration,
  AuthorizedIssue,
  Workspace,
} from "./request.ts";
import type { Verification } from "./verification.ts";
import type { Publication } from "./publication.ts";
import type { AgentIntervention, IssueComment } from "./intervention.ts";
import type { IssueLabel } from "./issueLabels.ts";
import type { RecoveryCommand } from "./recovery.ts";
import type { TokenPrices } from "./tokenPricing.ts";
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
  | "closing_issue"
  | "completed"
  | "intervention"
  | "stopped";
export interface History {
  at: number;
  kind: string;
  text: string;
  /** Snapshot of a confirmed outbound comment; subsequent GitHub edits are not synchronized. */
  comment?: Pick<IssueComment, "id" | "url" | "body">;
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
  /** Runtime selection for manual runs; issue runs retain request.runtime. */
  runtime?: AgentConfiguration;
  /** Prices captured once with the runtime selection when work first starts. */
  tokenPrices?: TokenPrices;
  workspace?: Workspace;
  verification?: Verification;
  publication?: Publication;
  phase?: "preparation" | "implementation" | "verification" | "publication";
  status: RunStatus;
  issueLabel?: { name: IssueLabel; state: "intent" | "confirmed" };
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
  /** LLM-authored outcome of the current Intento, separate from the cumulative PR description. */
  attemptSummary?: string;
  /** Commit candidate present before this Intento; equality means no new delivery. */
  attemptBaseHead?: string;
  pending: Pending[];
  interventions?: AgentIntervention[];
  recovery?: {
    notice?: IssueComment;
    consumed: string[];
    /** Admission is separate from delivery. One failed order can be resumed explicitly. */
    pending?: {
      command: RecoveryCommand;
      commentId: string;
      delivery: "pending" | "uncertain";
    };
    /** One outbound response is reconciled before admitting another order. */
    response?: { commentId: string; body: string };
    /** GitHub timestamps of the acknowledgement and completion, not the local clock. */
    lastAction?: { startedAt: number; finishedAt: number };
  };
  lastFinishedMessageId?: string;
  parts: PartView[];
  usage: Usage[];
  history: History[];
  gaps: string[];
}

export function isFinished(run: Pick<Run, "status">): boolean {
  return run.status === "completed" || run.status === "stopped";
}

/** A failed observation does not invalidate a confirmed review wait; uncertain effects do. */
export function canResumeReview(run: Run): boolean {
  const publication = run.publication;

  return Boolean(
    (run.status === "awaiting_review" ||
      (run.status === "intervention" &&
        run.phase === "publication" &&
        publication?.failureKind === "observation")) &&
    publication?.report &&
    publication.report.head === publication.head &&
    publication.operations[`status:${publication.head}:success`]?.state ===
      "confirmed" &&
    !publication.blocked &&
    !publication.recoveryRequired &&
    !run.recovery?.pending &&
    Object.values(publication.operations).every(
      (effect) => effect.state === "confirmed",
    ),
  );
}

export function consumption(usage: Usage[], prices?: TokenPrices) {
  const withTokens = usage.filter((u) => u.tokens !== null);
  const tokens = withTokens.length
    ? withTokens.reduce(
        (sum, u) => ({
          input: sum.input + u.tokens!.input + u.tokens!.cacheWrite,
          output: sum.output + u.tokens!.output + u.tokens!.reasoning,
          cacheRead: sum.cacheRead + u.tokens!.cacheRead,
        }),
        { input: 0, output: 0, cacheRead: 0 },
      )
    : null;
  const costs =
    tokens && prices
      ? {
          input: (tokens.input / 1_000_000) * prices.inputUsdPerMillion,
          output: (tokens.output / 1_000_000) * prices.outputUsdPerMillion,
          cacheRead:
            (tokens.cacheRead / 1_000_000) * prices.cacheReadUsdPerMillion,
        }
      : null;

  return {
    usedTokens: tokens ? tokens.input + tokens.output + tokens.cacheRead : null,
    tokens,
    prices: prices ?? null,
    costs,
    estimatedCost: costs ? costs.input + costs.output + costs.cacheRead : null,
    apiEquivalent: null,
    accreditedSpend: null,
    source: "OpenCode HTTP SDK 2.0.32 / assistant message identity",
    currency: "USD",
    modality: "OpenCode provider connection; no invoice attribution",
    coverage: !tokens
      ? "unavailable"
      : withTokens.length === usage.length && usage.every((u) => u.completed)
        ? "complete"
        : "partial",
    tariff: prices ? "Prices saved at execution start" : "Unavailable",
  };
}
