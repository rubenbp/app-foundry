import type { Run } from "../../domain/run.ts";
import { interpretComment, validPreview } from "../../domain/publication.ts";
import type { ConversationComment } from "../../domain/publication.ts";
import type { PublicationFacts } from "./ports.ts";
import { issueRecoveryCommand } from "../../domain/recovery.ts";

export function isOwn(run: Run, comment: ConversationComment) {
  return (
    run.publication!.ownComments.includes(comment.id) ||
    (comment.source === "issue" &&
      run.history.some((entry) => entry.comment?.id === comment.id)) ||
    comment.body.includes("<!-- app-foundry:") ||
    !comment.human
  );
}

export function isInterventionResponse(run: Run, comment: ConversationComment) {
  return (
    comment.source === "issue" &&
    Boolean(
      run.interventions?.some(
        (intervention) =>
          intervention.response?.id === comment.id &&
          intervention.deliveredAt !== undefined,
      ),
    )
  );
}

export function isReviewInstruction(run: Run, comment: ConversationComment) {
  if (
    run.status !== "awaiting_review" ||
    comment.source !== "issue" ||
    comment.createdAt < run.startedAt ||
    run.publication!.consumed.some((entry) => entry.id === comment.id) ||
    isOwn(run, comment) ||
    isInterventionResponse(run, comment)
  ) {
    return false;
  }
  const command = issueRecoveryCommand(run, comment);

  return command !== null && command.kind !== "retry";
}

export function hasPendingReviewInstructions(
  run: Run,
  facts: PublicationFacts,
) {
  return facts.comments.some(
    (comment) =>
      isReviewInstruction(run, comment) &&
      !run.recovery?.consumed.includes(comment.id),
  );
}

export function readyToMerge(run: Run, facts: PublicationFacts) {
  const publication = run.publication!;
  const report = publication.report;
  if (
    !report ||
    publication.blocked ||
    publication.recoveryRequired ||
    run.recovery?.pending ||
    hasPendingReviewInstructions(run, facts)
  ) {
    return false;
  }
  const project = run.request!.configuration;
  const unprocessedInvalidation = facts.comments.some(
    (comment) =>
      !isOwn(run, comment) &&
      !isInterventionResponse(run, comment) &&
      !(
        comment.source === "issue" &&
        run.recovery?.consumed.includes(comment.id)
      ) &&
      interpretComment(comment.body).kind === "invalidate" &&
      !publication.consumed.some((consumed) => consumed.id === comment.id),
  );

  return Boolean(
    report.head === publication.head &&
    !unprocessedInvalidation &&
    facts.request.open &&
    facts.pull?.open &&
    !facts.pull.merged &&
    facts.pull.base === project.baseBranch &&
    facts.pull.head === publication.head &&
    facts.remoteHead === publication.head &&
    validPreview(
      facts.preview,
      publication.head,
      run.request!.repository,
      project.publication.projectId,
      project.publication.previewEnvironment ?? "Preview",
    ) &&
    facts.preview?.url === report.preview,
  );
}
