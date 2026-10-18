import type { Run, Usage, Pending } from "../domain/run.ts";

export type Fact =
  | { type: "status"; status: string }
  | {
      type: "part";
      id: string;
      messageId: string;
      kind: string;
      text: string;
      label?: string;
    }
  | { type: "usage"; usage: Usage }
  | { type: "pending"; pending: Pending[] }
  | { type: "finished"; text: string; messageId?: string }
  | { type: "error"; text: string }
  | { type: "gap"; text: string }
  | { type: "observed" }
  | { type: "process-started"; pid: number }
  | { type: "process-exit"; detail: string };

export interface AgentPort {
  start(
    emit: (fact: Fact) => void,
    protect?: (secrets: string[]) => void,
  ): Promise<NonNullable<Run["process"]>>;
  create(): Promise<string>;
  /** Observe an existing conversation without creating a session or resending its original task. */
  resume(sessionId: string): Promise<void>;
  send(sessionId: string, task: string): Promise<void>;
  stop(sessionId: string | null): Promise<{ exited: boolean; detail: string }>;
}
