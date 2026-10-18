import type { Run } from "../../domain/run.ts";
import { interpretComment } from "../../domain/publication.ts";
import { publicChecks } from "../../domain/production.ts";
import type { PublicationFacts, ProductionPort } from "./ports.ts";
import type { PublicationRuntime } from "./runtime.ts";
import { isOwn, reportIntact } from "./review-policy.ts";
import { candidateEvidence } from "./evidence.ts";

export class IntegratedPublication {
  private runtime: PublicationRuntime;
  private production?: ProductionPort;
  constructor(runtime: PublicationRuntime, production?: ProductionPort) {
    this.runtime = runtime;
    this.production = production;
  }
  async advance(run: Run, facts: PublicationFacts) {
    const publication = run.publication!;
    const pull = facts.pull!;
    publication.pull = pull;
    publication.observedAt = this.runtime.factory.now();
    // Keep the observed integration even when it violates the contract.
    if (publication.mergeSha && publication.mergeSha !== pull.mergeSha) {
      publication.blocked =
        "Incidencia: el commit integrado observado cambió; revisión manual requerida.";
      this.runtime.save(run);
      throw new Error(publication.blocked);
    }
    publication.mergeSha = pull.mergeSha;
    this.runtime.save(run);
    if (publication.blocked) throw new Error(publication.blocked);
    // A remote status write cannot be atomic with a human merge. Reconstruct
    // the accepted snapshot at integration from durable history and GitHub's
    // last gate at that time, even if a later local revocation cleared it.
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
          comment.createdAt <= (pull.mergedAt ?? 0) &&
          interpretComment(comment.body).kind === "invalidate",
      );
      let conflicting = false;
      for (const comment of invalidations)
        if (
          await this.runtime.port.canWrite(
            run.request!.repository,
            comment.author,
          )
        )
          conflicting = true;
      if (
        !accepted ||
        !pull.mergeSha ||
        !pull.mergedAt ||
        !pull.mergedBy ||
        pull.base !== run.request!.configuration.baseBranch ||
        pull.head !== accepted.head ||
        accepted.head !== publication.head ||
        accepted.at >= pull.mergedAt ||
        facts.request.title !== run.request!.title ||
        facts.request.body !== run.request!.body ||
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
      publication.production = { status: "pending", observations: [] };
      run.status = "checking_production";
      this.runtime.save(run);
    }
    const production = publication.production!;
    if (production.status === "intervention")
      throw new Error(production.error ?? "Production requires intervention");
    if (
      facts.request.title !== run.request!.title ||
      facts.request.body !== run.request!.body ||
      pull.head !== publication.integratedAcceptance!.head ||
      !pull.mergeSha
    )
      throw new Error(
        "Request or integrated candidate changed; production closure blocked",
      );
    if (!this.production)
      throw new Error("Production adapter required after observed merge");
    run.status = "checking_production";
    run.error = null;
    publication.observationError = null;
    run.endedAt = null;
    this.runtime.save(run);
    const deployment = await this.production.inspect(
      this.runtime.context(run),
      pull.mergeSha,
    );
    production.observations.push({
      at: this.runtime.factory.now(),
      deployment,
    });
    production.deployment = deployment ?? undefined;
    this.runtime.save(run);
    if (
      !deployment ||
      deployment.state === "pending" ||
      deployment.state === "inactive"
    )
      return;
    if (deployment.state !== "success")
      throw new Error(
        `Production deployment ${deployment.state}; intervention required`,
      );
    if (
      deployment.head !== pull.mergeSha ||
      deployment.repository !== run.request!.repository ||
      deployment.projectId !==
        run.request!.configuration.publication.projectId ||
      deployment.environment !==
        (run.request!.configuration.publication.productionEnvironment ??
          "Production")
    )
      throw new Error("Production deployment identity mismatch");
    const checks = publicChecks(
      run.request!.body,
      run.verification!.criteria.length,
    );
    const evidence = await this.production.verify(
      this.runtime.context(run),
      pull.mergeSha,
      checks,
    );
    const complete =
      evidence.origin ===
        run.request!.configuration.publication.productionOrigin &&
      !evidence.error &&
      evidence.servedHead === pull.mergeSha &&
      Boolean(evidence.browser) &&
      evidence.checks.length === checks.length &&
      evidence.checks.every(
        (result, index) =>
          result.passed &&
          JSON.stringify(result.check) === JSON.stringify(checks[index]),
      );
    // Write failed observations too. No successful terminal state before durable evidence.
    const partId = `production-${pull.mergeSha}`;
    this.runtime.factory.ingest(
      run.id,
      {
        type: "part",
        id: partId,
        messageId: "production",
        kind: "evidence",
        label: "Producción: dominio público, versión y criterios",
        text: JSON.stringify(evidence, null, 2),
      },
      1_100_000,
    );
    Object.assign(run, this.runtime.factory.view(run.id), { publication });
    production.evidencePartId = partId;
    this.runtime.save(run);
    if (
      !complete ||
      this.runtime.factory
        .view(run.id)!
        .parts.find((part) => part.id === partId)?.truncated
    )
      throw new Error(
        "Public version or complete requested behavior unverified; inspect production evidence",
      );
    production.servedHead = pull.mergeSha;
    production.status = "verified";
    production.verifiedAt = this.runtime.factory.now();
    this.runtime.save(run);
    const origin = `<!-- app-foundry:${run.id}:production:${pull.mergeSha} -->`;
    const body = this.runtime.factory.clean(
      `${origin}\n## Producción comprobada\n\nEjecución: ${run.id}\nBase: ${run.workspace!.baseSha}\nCandidato aceptado: ${publication.integratedAcceptance!.head}\nCommit integrado: ${pull.mergeSha}\nPR: ${pull.url}\nDeployment: ${deployment.id} · ${deployment.environment} · ${deployment.projectId}\nDominio público: ${evidence.origin}\nSHA servido: ${evidence.servedHead}\nNavegador: ${evidence.browser}\n\n${evidence.checks.map((result) => `- [x] Criterio ${result.check.criterion}: ${result.check.path} ${result.check.selector} — ${result.observed}`).join("\n")}\n\nEvidencia persistida: ${partId}. La comprobación cubre las aserciones declaradas en la petición y revisadas con el candidato; no acredita comportamientos no expresados en ellas.`,
      55_000,
    );
    if (body.truncated)
      throw new Error("Production report exceeds evidence limit");
    const report = await this.runtime.effect(
      run,
      `production-report:${pull.mergeSha}`,
      async () => {
        const current = await this.runtime.facts(run, false);
        if (
          current.request.title !== run.request!.title ||
          current.request.body !== run.request!.body
        )
          throw new Error("Request changed before production report");
        return current.comments.find(
          (comment) => comment.source === "issue" && comment.body === body.text,
        );
      },
      () => this.production!.comment(this.runtime.context(run), body.text),
    );
    production.report = { id: report.id, url: report.url };
    if (!publication.ownComments.includes(report.id))
      publication.ownComments.push(report.id);
    this.runtime.save(run);
    await this.runtime.effect(
      run,
      `close-issue:${pull.mergeSha}`,
      async () => {
        const current = await this.runtime.facts(run, false);
        if (
          current.request.title !== run.request!.title ||
          current.request.body !== run.request!.body ||
          !current.comments.some(
            (comment) => comment.id === report.id && comment.body === body.text,
          )
        )
          throw new Error(
            "Production evidence or request changed before closure",
          );
        return current.request.open ? undefined : true;
      },
      async () => {
        await this.production!.closeIssue(this.runtime.context(run));
        return true;
      },
    );
    production.closedAt = this.runtime.factory.now();
    run.status = "completed";
    run.endedAt = this.runtime.factory.now();
    run.error = null;
    this.runtime.factory.record(
      run,
      "completed",
      `Production ${pull.mergeSha} verified and evidence published: ${report.url}`,
    );
    this.runtime.save(run);
    this.runtime.factory.active = null;
  }
}
