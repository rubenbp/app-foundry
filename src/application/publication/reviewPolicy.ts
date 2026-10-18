import { createHash } from "node:crypto";
import type { Run } from "../../domain/run.ts";
import { interpretComment, validPreview } from "../../domain/publication.ts";
import type {
  ConversationComment,
  Publication,
} from "../../domain/publication.ts";
import type { PublicationFacts, PublicationPort } from "./ports.ts";

export function isOwn(run: Run, comment: ConversationComment) {
  return (
    run.publication!.ownComments.includes(comment.id) ||
    comment.body.includes("<!-- app-foundry:") ||
    !comment.human
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
export async function canMerge(
  run: Run,
  facts: PublicationFacts,
  port: PublicationPort,
) {
  const publication = run.publication!;
  const report = publication.report;
  const acceptance = publication.acceptance;
  if (!report || !acceptance || publication.blocked) {
    return false;
  }
  const context = {
    repository: run.request!.repository,
    project: run.request!.configuration,
  };
  const comment = facts.comments.find(
    (comment) => comment.id === acceptance.commentId,
  );
  const intent = comment ? interpretComment(comment.body) : null;
  const unchangedReport = reportIntact(run, facts);
  const newInstructions = facts.comments.some(
    (comment) =>
      !isOwn(run, comment) &&
      !publication.consumed.some((consumed) => consumed.id === comment.id),
  );

  return Boolean(
    unchangedReport &&
    !newInstructions &&
    facts.request.open &&
    facts.pull?.open &&
    !facts.pull.merged &&
    facts.pull.head === publication.head &&
    facts.remoteHead === publication.head &&
    validPreview(
      facts.preview,
      publication.head,
      context.repository,
      context.project.publication.projectId,
      context.project.publication.previewEnvironment ?? "Preview",
    ) &&
    facts.preview?.url === report.preview &&
    acceptance.head === publication.head &&
    acceptance.preview === report.preview &&
    comment &&
    !isOwn(run, comment) &&
    comment.author === acceptance.author &&
    comment.createdAt > report.at &&
    comment.createdAt === acceptance.at &&
    comment.updatedAt === comment.createdAt &&
    intent?.kind === "accept" &&
    intent.head === publication.head &&
    intent.preview === report.preview &&
    (await port.canWrite(context.repository, acceptance.author)),
  );
}
