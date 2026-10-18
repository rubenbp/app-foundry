import { createHash } from "node:crypto";
import type { Run } from "../../domain/run.ts";
import { validPreview } from "../../domain/publication.ts";
import type {
  ConversationComment,
  Publication,
} from "../../domain/publication.ts";
import type { PublicationFacts } from "./ports.ts";

export function isOwn(run: Run, comment: ConversationComment) {
  return (
    run.publication!.ownComments.includes(comment.id) ||
    comment.body.includes("<!-- app-foundry:") ||
    !comment.human
  );
}

export function isInterventionResponse(run: Run, comment: ConversationComment) {
  return (
    comment.source === "issue" &&
    (run.recovery?.consumed.includes(comment.id) ||
      Boolean(
        run.interventions?.some(
          (intervention) =>
            intervention.response?.id === comment.id &&
            intervention.deliveredAt !== undefined,
        ),
      ))
  );
}
export function reportIntact(
  run: Run,
  facts: PublicationFacts,
  report: Publication["report"] = run.publication!.report,
) {
  return Boolean(
    report &&
    [report, ...report.evidence].every((expected) =>
      facts.comments.some(
        (comment) =>
          comment.id === expected.id &&
          createHash("sha256").update(comment.body).digest("hex") ===
            expected.bodyHash,
      ),
    ),
  );
}
export function readyToMerge(run: Run, facts: PublicationFacts) {
  const publication = run.publication!;
  const report = publication.report;
  if (!report || publication.blocked || publication.recoveryRequired) {
    return false;
  }
  const project = run.request!.configuration;
  const newInstructions = facts.comments.some(
    (comment) =>
      !isOwn(run, comment) &&
      !publication.consumed.some((consumed) => consumed.id === comment.id),
  );

  return Boolean(
    report.head === publication.head &&
    reportIntact(run, facts) &&
    !newInstructions &&
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
