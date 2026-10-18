import type { ManagedProject, Workspace } from "../../domain/request.ts";
import type {
  ConversationComment,
  Preview,
  PullCandidate,
} from "../../domain/publication.ts";
import type { PublicCheck, PublicEvidence } from "../../domain/production.ts";

export interface ProductionPort {
  inspect(
    context: PublicationContext,
    integratedSha: string,
  ): Promise<Preview | null>;
  verify(
    context: PublicationContext,
    integratedSha: string,
    checks: PublicCheck[],
  ): Promise<PublicEvidence>;
  comment(
    context: PublicationContext,
    body: string,
  ): Promise<ConversationComment>;
  closeIssue(context: PublicationContext): Promise<void>;
}

export interface PublicationContext {
  repository: string;
  issue: number;
  runId: string;
  head: string;
  project: ManagedProject;
  workspace: Workspace;
  pull?: PullCandidate;
}
export interface PublicationFacts {
  request: { title: string; body: string; open: boolean };
  remoteHead: string | null;
  pull: PullCandidate | null;
  comments: ConversationComment[];
  preview: Preview | null;
  mergeStatus?: {
    head: string;
    state: "pending" | "success" | "failure" | "error";
    at: number;
  } | null;
  status: {
    head: string;
    state: "pending" | "success" | "failure" | "error";
  } | null;
}
// Todos los efectos se realizan en este límite. Se omite deliberadamente la operación de integración.
export interface PublicationPort {
  inspect(
    context: PublicationContext,
    options?: { preview: boolean },
  ): Promise<PublicationFacts>;
  push(context: PublicationContext): Promise<void>;
  openPull(context: PublicationContext): Promise<PullCandidate>;
  comment(
    context: PublicationContext,
    body: string,
  ): Promise<ConversationComment>;
  status(
    context: PublicationContext,
    state: "pending" | "success" | "failure" | "error",
  ): Promise<void>;
  canWrite(repository: string, author: string): Promise<boolean>;
  prepareHead(context: PublicationContext, head: string): Promise<void>;
}
