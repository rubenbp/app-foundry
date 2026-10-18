import type { Run } from "../../domain/run.ts";
import { interpretComment } from "../../domain/publication.ts";
import type { PublicationFacts } from "./ports.ts";
import type { PublicationRuntime } from "./runtime.ts";
import { isOwn, isInterventionResponse, reportIntact } from "./reviewPolicy.ts";
import { candidateEvidence } from "./evidence.ts";

export class IntegratedPublication {
  private runtime: PublicationRuntime;

  constructor(runtime: PublicationRuntime) {
    this.runtime = runtime;
  }

  async advance(run: Run, facts: PublicationFacts) {
    const publication = run.publication!;
    const pull = facts.pull!;
    publication.pull = pull;
    publication.observedAt = this.runtime.factory.now();
    // Conserva la integración observada aunque incumpla el contrato.
    if (publication.mergeSha && publication.mergeSha !== pull.mergeSha) {
      publication.blocked =
        "Incidencia: el commit integrado observado cambió; revisión manual requerida.";
      this.runtime.save(run);
      throw new Error(publication.blocked);
    }
    publication.mergeSha = pull.mergeSha;
    this.runtime.save(run);
    if (publication.blocked) {
      throw new Error(publication.blocked);
    }
    // Una escritura de estado remoto no puede ser atómica con una integración humana. Reconstruye
    // la instantánea aceptada en el momento de integrar a partir del historial duradero y de la
    // última barrera de GitHub en ese momento, aunque una revocación local posterior la haya borrado.
    const accepted =
      publication.integratedAcceptance ??
      publication.acceptance ??
      (run.status === "intervention"
        ? undefined
        : publication.acceptances
            .toReversed()
            .find(
              (acceptance) =>
                acceptance.head === pull.head &&
                acceptance.at < (facts.mergeStatus?.at ?? 0),
            ));
    if (!publication.integratedAcceptance) {
      const report = publication.reports
        .toReversed()
        .find(
          (report) =>
            report.head === accepted?.head &&
            report.preview === accepted.preview &&
            report.at < accepted.at,
        );
      const comment = facts.comments.find(
        (comment) => comment.id === accepted?.commentId,
      );
      const intent = comment ? interpretComment(comment.body) : null;
      const invalidations = facts.comments.filter(
        (comment) =>
          !isOwn(run, comment) &&
          !isInterventionResponse(run, comment) &&
          comment.createdAt <= (pull.mergedAt ?? 0) &&
          interpretComment(comment.body).kind === "invalidate",
      );
      let conflicting = false;
      for (const comment of invalidations) {
        if (
          await this.runtime.port.canWrite(
            run.request!.repository,
            comment.author,
          )
        ) {
          conflicting = true;
        }
      }
      if (
        !accepted ||
        !pull.mergeSha ||
        !pull.mergedAt ||
        !pull.mergedBy ||
        pull.base !== run.request!.configuration.baseBranch ||
        pull.head !== accepted.head ||
        accepted.head !== publication.head ||
        accepted.at >= pull.mergedAt ||
        !report ||
        !reportIntact(run, facts, report) ||
        !comment ||
        isOwn(run, comment) ||
        comment.author !== accepted.author ||
        comment.createdAt !== accepted.at ||
        comment.updatedAt !== comment.createdAt ||
        intent?.kind !== "accept" ||
        intent.head !== accepted.head ||
        intent.preview !== accepted.preview ||
        conflicting ||
        facts.mergeStatus?.head !== accepted.head ||
        facts.mergeStatus.state !== "success" ||
        facts.mergeStatus.at <= accepted.at ||
        facts.mergeStatus.at > pull.mergedAt ||
        !(await this.runtime.port.canWrite(
          run.request!.repository,
          accepted.author,
        )) ||
        !(await this.runtime.port.canWrite(
          run.request!.repository,
          pull.mergedBy,
        ))
      ) {
        publication.blocked =
          "Incidencia: merge externo fuera del contrato de aceptación humana vigente.";
        this.runtime.save(run);
        throw new Error(publication.blocked);
      }
      candidateEvidence(this.runtime.factory, run);
      publication.report = report;
      publication.integratedAcceptance = accepted;
      delete publication.acceptance;
      this.runtime.factory.record(
        run,
        "merge-observed",
        `Base ${run.workspace!.baseSha}; accepted candidate ${accepted.head}; integrated ${pull.mergeSha}; merged by ${pull.mergedBy}`,
      );
      this.runtime.save(run);
    }
    if (
      pull.head !== publication.integratedAcceptance!.head ||
      !pull.mergeSha
    ) {
      throw new Error("Integrated candidate changed; issue closure blocked");
    }
    run.status = "closing_issue";
    run.error = null;
    publication.observationError = null;
    run.endedAt = null;
    this.runtime.save(run);
    const origin = `<!-- app-foundry:${run.id}:integration:${pull.mergeSha} -->`;
    const body = `${origin}\n\nEl código de este issue se ha integrado en el producto.\n\n${pull.url}`;
    const report = await this.runtime.effect(
      run,
      `integration-report:${pull.mergeSha}`,
      async () => {
        const current = await this.runtime.facts(run, false);

        return current.comments.find(
          (comment) => comment.source === "issue" && comment.body === body,
        );
      },
      () => this.runtime.port.commentIssue(this.runtime.context(run), body),
    );
    publication.integrationReport = { id: report.id, url: report.url };
    if (!publication.ownComments.includes(report.id)) {
      publication.ownComments.push(report.id);
    }
    this.runtime.save(run);
    await this.runtime.effect(
      run,
      `close-issue:${pull.mergeSha}`,
      async () => {
        const current = await this.runtime.facts(run, false);
        if (
          !current.comments.some(
            (comment) => comment.id === report.id && comment.body === body,
          )
        ) {
          throw new Error("Integration report changed before closure");
        }
        return current.request.open ? undefined : true;
      },
      async () => {
        await this.runtime.port.closeIssue(this.runtime.context(run));
        return true;
      },
    );
    publication.closedAt = this.runtime.factory.now();
    run.status = "completed";
    run.endedAt = this.runtime.factory.now();
    run.error = null;
    this.runtime.factory.record(
      run,
      "completed",
      `Accepted candidate integrated as ${pull.mergeSha}; integration report published: ${report.url}`,
    );
    this.runtime.save(run);
    this.runtime.factory.active = null;
  }
}
