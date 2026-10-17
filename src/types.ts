export interface FactoryConfig {
  dataDir: string;
  projectDir: string;
  provider: string;
  model: string;
  auth: "opencode";
  opencodeCli?: string;
}

export type RunStatus = "starting" | "running" | "waiting" | "awaiting_verification" | "intervention" | "stopped";
export interface History { at: number; kind: string; text: string }
export interface PartView { id: string; messageId: string; kind: string; label: string; updatedAt: number; truncated: boolean }
export interface Usage {
  id: string;
  provider: string;
  model: string;
  tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number } | null;
  sdkCost: number | null;
  completed: boolean;
}
export interface Pending { id: string; kind: "permission" | "question"; text: string }
export interface Run {
  id: string;
  attempt: number;
  task: string;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  sessionId: string | null;
  process: { pid: number; version: string; configuration: Record<string, unknown>; exited?: boolean } | null;
  lastObservation: number | null;
  lastActivity: number | null;
  agentStatus: string | null;
  error: string | null;
  result: string | null;
  pending: Pending[];
  parts: PartView[];
  usage: Usage[];
  history: History[];
  gaps: string[];
}
export type Fact =
  | { type: "status"; status: string }
  | { type: "part"; id: string; messageId: string; kind: string; text: string; label?: string }
  | { type: "usage"; usage: Usage }
  | { type: "pending"; pending: Pending[] }
  | { type: "finished"; text: string }
  | { type: "error"; text: string }
  | { type: "gap"; text: string }
  | { type: "observed" }
  | { type: "process-started"; pid: number }
  | { type: "process-exit"; detail: string };

export interface AgentPort {
  start(emit: (fact: Fact) => void, protect?: (secrets: string[]) => void): Promise<NonNullable<Run["process"]>>;
  create(): Promise<string>;
  send(sessionId: string, task: string): Promise<void>;
  stop(sessionId: string | null): Promise<{ exited: boolean; detail: string }>;
}

export function consumption(usage: Usage[]) {
  const withTokens = usage.filter(u => u.tokens !== null);
  const observed = withTokens.length ? withTokens.reduce((sum, u) => sum + u.tokens!.input + u.tokens!.output + u.tokens!.reasoning + u.tokens!.cacheRead + u.tokens!.cacheWrite, 0) : null;
  const priced = usage.filter(u => u.completed && u.sdkCost !== null && u.sdkCost > 0);
  return {
    observedTokens: observed,
    estimatedCost: priced.length ? priced.reduce((sum, u) => sum + u.sdkCost!, 0) : null,
    apiEquivalent: null,
    accreditedSpend: null,
    source: "OpenCode HTTP SDK 2.0.32 / assistant message identity",
    currency: "USD",
    modality: "OpenCode OAuth / subscription; no invoice attribution",
    coverage: usage.length && withTokens.length === usage.length && usage.every(u => u.completed) ? "observed messages; provider completeness unverified" : "partial / unavailable",
    tariff: "OpenCode effective catalog; tariff version unavailable",
  };
}
