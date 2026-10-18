import { createHash } from "node:crypto";
import type { Factory } from "../factory.ts";
import { sanitizedRecord } from "../sanitize.ts";
import type { Run } from "../types.ts";
import type { ManagedProject, Workspace } from "../domain/request.ts";
import {
  fenced,
  interpretComment,
  publicationPlan,
  validPreview,
} from "../domain/publication.ts";
import type {
  ConversationComment,
  Preview,
  PullCandidate,
  Publication,
} from "../domain/publication.ts";

import {
  publicChecks,
  type PublicCheck,
  type PublicEvidence,
} from "../domain/production.ts";

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
// All effects live at this boundary. There is deliberately no merge operation.
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

class StatusSkippedAfterMerge extends Error {}

class ObservedMerge extends Error {
  readonly facts: PublicationFacts;
  constructor(facts: PublicationFacts) {
    super("Human merge observed during candidate publication");
    this.facts = facts;
  }
}

export class CandidatePublication {
  private factory: Factory;
  private port: PublicationPort;
  private production?: ProductionPort;
  private busy?: Promise<void>;
  private stopping = false;
  constructor(
    factory: Factory,
    port: PublicationPort,
    production?: ProductionPort,
  ) {
    this.factory = factory;
    this.port = port;
    this.production = production;
  }
  async poll() {
    if (this.busy) return this.busy;
    this.busy = this.advance().finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }
  private save(run: Run) {
    this.factory.assertRunning(run.id);
    this.factory.persist({
      ...run,
      publication: sanitizedRecord(run.publication, this.factory.clean),
    });
  }
  private context(run: Run): PublicationContext {
    return {
      repository: run.request!.repository,
      issue: run.request!.number,
      runId: run.id,
      head: run.publication!.head,
      project: run.request!.configuration,
      workspace: run.workspace!,
      pull: run.publication!.pull,
    };
  }
  private async effect<T>(
    run: Run,
    key: string,
    observe: () => Promise<T | undefined>,
    perform: () => Promise<T>,
  ): Promise<T> {
    this.factory.assertRunning(run.id);
    if (this.stopping)
      throw new Error("Publication stopping; no new remote effects allowed");
    // Query before every retry, including a lost confirmation after remote success.
    const found = await observe();
    this.factory.assertRunning(run.id);
    let result: T;
    if (found !== undefined) result = found;
    else {
      if (this.stopping)
        throw new Error("Publication stopping; no new remote effects allowed");
      run.publication!.operations[key] = {
        state: "intent",
        at: this.factory.now(),
      };
      this.factory.record(run, "intent", key);
      this.save(run);
      result = await perform();
      this.factory.assertRunning(run.id);
    }
    if (run.publication!.operations[key]?.state !== "confirmed") {
      run.publication!.operations[key] = {
        state: "confirmed",
        at: this.factory.now(),
      };
      this.factory.record(run, "confirmed", key);
      this.save(run);
    }
    return result;
  }
  private async facts(run: Run, preview = true) {
    const facts = await this.port.inspect(this.context(run), { preview });
    // Every pre-integration read can race with the human merge. Transition before
    // treating the closed PR or retired preview as a candidate invalidation.
    if (
      facts.pull?.merged &&
      !run.publication!.integratedAcceptance &&
      !run.publication!.recoveryRequired
    )
      throw new ObservedMerge(facts);
    return facts;
  }
  private isOwn(run: Run, comment: ConversationComment) {
    return (
      run.publication!.ownComments.includes(comment.id) ||
      comment.body.includes("<!-- app-foundry:") ||
      !comment.human
    );
  }
  private reportIntact(
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
  private async canMerge(run: Run, facts: PublicationFacts) {
    const publication = run.publication!;
    const report = publication.report;
    const acceptance = publication.acceptance;
    if (!report || !acceptance || publication.blocked) return false;
    const context = this.context(run);
    const comment = facts.comments.find(
      (comment) => comment.id === acceptance.commentId,
    );
    const intent = comment ? interpretComment(comment.body) : null;
    const unchangedReport = this.reportIntact(run, facts);
    const newInstructions = facts.comments.some(
      (comment) =>
        !this.isOwn(run, comment) &&
        !publication.consumed.some((consumed) => consumed.id === comment.id),
    );

    return Boolean(
      unchangedReport &&
      !newInstructions &&
      facts.request.open &&
      facts.request.title === run.request!.title &&
      facts.request.body === run.request!.body &&
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
      !this.isOwn(run, comment) &&
      comment.author === acceptance.author &&
      comment.createdAt > report.at &&
      comment.createdAt === acceptance.at &&
      comment.updatedAt === comment.createdAt &&
      intent?.kind === "accept" &&
      intent.head === publication.head &&
      intent.preview === report.preview &&
      (await this.port.canWrite(context.repository, acceptance.author)),
    );
  }
  private async setStatus(
    run: Run,
    state: "pending" | "success" | "failure" | "error",
  ) {
    const context = this.context(run);
    try {
      await this.effect(
        run,
        `status:${context.head}:${state}`,
        async () => {
          const facts = await this.facts(run, state === "success");
          if (facts.pull?.merged) throw new StatusSkippedAfterMerge();
          if (state === "success" && !(await this.canMerge(run, facts)))
            throw new Error(
              "Candidate changed before favorable merge status; acceptance revoked",
            );
          const status = facts.status;

          return status?.head === context.head && status.state === state
            ? true
            : undefined;
        },
        async () => {
          await this.port.status(context, state);
          return true;
        },
      );
    } catch (error) {
      if (!(error instanceof StatusSkippedAfterMerge)) throw error;
      this.factory.record(
        run,
        "status-skipped",
        `${state}: PR already integrated; no status effect confirmed`,
      );
      this.save(run);
    }
  }
  private async comment(run: Run, key: string, text: string) {
    const origin = `<!-- app-foundry:${run.id}:${key} -->`;
    const body = this.factory.clean(
      `${origin}\n${text}`,
      Number.MAX_SAFE_INTEGER,
    ).text;
    if (body.length > 60_000)
      throw new Error("Publication comment exceeds GitHub limit");
    const result = await this.effect(
      run,
      key,
      async () => {
        const facts = await this.facts(run, false);
        if (
          !facts.request.open ||
          facts.request.title !== run.request!.title ||
          facts.request.body !== run.request!.body ||
          facts.pull?.head !== run.publication!.head ||
          !facts.pull.open ||
          facts.pull.merged
        )
          throw new Error(
            "Request or PR changed before publishing review guidance",
          );

        return facts.comments.find((comment) => comment.body === body);
      },
      () => this.port.comment(this.context(run), body),
    );
    if (!run.publication!.ownComments.includes(result.id))
      run.publication!.ownComments.push(result.id);
    this.save(run);
    return result;
  }
  private evidence(run: Run) {
    const verification = run.verification!;
    const output = (id: string) => {
      const part = run.parts.find((part) => part.id === id);
      const text = this.factory.output(run.id, id);
      if (!part || part.truncated || text === null)
        throw new Error(`Complete evidence missing: ${id}`);
      return text;
    };
    if (
      verification.headSha !== run.publication!.head ||
      verification.status !== "passed" ||
      verification.controls.length ||
      verification.effectsUncertain ||
      !verification.checks.length ||
      verification.checks.some(
        (check) =>
          check.status !== "passed" ||
          check.code !== 0 ||
          check.cleanup !== "confirmed",
      )
    )
      throw new Error(
        "Valid complete technical evidence for the current head required",
      );
    return [
      `Petición: ${run.request!.title}\n${run.request!.body}`,
      `Diff acumulado completo ${verification.baseSha}..${verification.headSha}\n${output(verification.diffPartId)}`,
      `Configuración\n${output(verification.configurationPartId)}`,
      ...verification.checks.map(
        (check) =>
          `Verificación ${check.command}: exit ${check.code}\n${output(check.partId)}`,
      ),
      ...verification.criteria.map(
        (criterion, index) =>
          `Criterio ${index + 1}: ${criterion.text}\nJuicio humano pendiente\nEvidencia técnica: ${criterion.evidence.join(", ")}\nFalta: ${criterion.missing.join("; ")}`,
      ),
    ].join("\n\n");
  }
  private async report(run: Run) {
    const publication = run.publication!;
    const preview = publication.preview!;
    const evidence = this.evidence(run);
    const digest = createHash("sha256").update(evidence).digest("hex");
    const key = `report:${publication.head}:${preview.id}:${digest}`;
    let details = fenced(evidence);
    const fragments: NonNullable<typeof publication.report>["evidence"] = [];
    if (details.length > 45_000) {
      const links: string[] = [];
      // Split by UTF-16 code units without cutting a surrogate pair.
      for (let start = 0, index = 1; start < evidence.length; index++) {
        let end = Math.min(start + 20_000, evidence.length);
        if (end < evidence.length && /[\uD800-\uDBFF]/.test(evidence[end - 1]))
          end--;
        const comment = await this.comment(
          run,
          `${key}:evidence:${index}`,
          `Evidencia completa, fragmento ${index}. SHA ${publication.head}.\n\n${fenced(evidence.slice(start, end))}`,
        );
        fragments.push({
          id: comment.id,
          url: comment.url,
          bodyHash: createHash("sha256").update(comment.body).digest("hex"),
        });
        links.push(`[Fragmento ${index}](${comment.url})`);
        start = end;
      }
      details = links.join("\n\n");
    }
    const comment = await this.comment(
      run,
      key,
      `## Informe de revisión de la Factory\n\nPetición: ${run.request!.url}\nEjecución: ${run.id}\nBase: ${run.verification!.baseSha}\nHead: ${publication.head}\nDiff acumulado: https://github.com/${run.request!.repository}/compare/${run.verification!.baseSha}...${publication.head}\nPreview: ${preview.url}\nDeployment: ${preview.id} · ${preview.environment} · ${preview.projectId}\n\n${details}\n\n### Limitaciones\n\n${[...run.verification!.limitations, ...publication.limitations].map((line) => `- ${line}`).join("\n")}\n\n### Decisión humana\n\nRevisa la preview y la evidencia de cada criterio. Para aceptar esta versión, publica un comentario nuevo en el issue o la conversación principal de esta PR:\n\n${fenced(`Acepto la versión ${publication.head} y su preview ${preview.url}.`)}\n\nPuedes consultar el informe, pedir una corrección o cancelar. Las correcciones y cancelaciones invalidan el control favorable y requieren intervención en este incremento. El merge lo realiza una persona en GitHub.`,
    );
    publication.report = {
      id: comment.id,
      url: comment.url,
      at: comment.createdAt,
      head: publication.head,
      preview: preview.url!,
      bodyHash: createHash("sha256").update(comment.body).digest("hex"),
      evidence: fragments,
    };
    publication.reports.push(publication.report);
    this.save(run);
  }
  private async observeMerge(run: Run, facts: PublicationFacts) {
    const publication = run.publication!;
    const pull = facts.pull!;
    publication.pull = pull;
    publication.observedAt = this.factory.now();
    // Keep the observed integration even when it violates the contract.
    if (publication.mergeSha && publication.mergeSha !== pull.mergeSha) {
      publication.blocked =
        "Incidencia: el commit integrado observado cambió; revisión manual requerida.";
      this.save(run);
      throw new Error(publication.blocked);
    }
    publication.mergeSha = pull.mergeSha;
    this.save(run);
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
          !this.isOwn(run, comment) &&
          comment.createdAt <= (pull.mergedAt ?? 0) &&
          interpretComment(comment.body).kind === "invalidate",
      );
      let conflicting = false;
      for (const comment of invalidations)
        if (await this.port.canWrite(run.request!.repository, comment.author))
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
        !this.reportIntact(run, facts, report) ||
        !comment ||
        this.isOwn(run, comment) ||
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
        !(await this.port.canWrite(run.request!.repository, accepted.author)) ||
        !(await this.port.canWrite(run.request!.repository, pull.mergedBy))
      ) {
        publication.blocked =
          "Incidencia: merge externo fuera del contrato de aceptación humana vigente.";
        this.save(run);
        throw new Error(publication.blocked);
      }
      this.evidence(run);
      publication.report = report;
      publication.integratedAcceptance = accepted;
      delete publication.acceptance;
      this.factory.record(
        run,
        "merge-observed",
        `Base ${run.workspace!.baseSha}; accepted candidate ${accepted.head}; integrated ${pull.mergeSha}; merged by ${pull.mergedBy}`,
      );
      publication.production = { status: "pending", observations: [] };
      run.status = "checking_production";
      this.save(run);
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
    this.save(run);
    const deployment = await this.production.inspect(
      this.context(run),
      pull.mergeSha,
    );
    production.observations.push({ at: this.factory.now(), deployment });
    production.deployment = deployment ?? undefined;
    this.save(run);
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
      this.context(run),
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
    this.factory.ingest(
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
    Object.assign(run, this.factory.view(run.id), { publication });
    production.evidencePartId = partId;
    this.save(run);
    if (
      !complete ||
      this.factory.view(run.id)!.parts.find((part) => part.id === partId)
        ?.truncated
    )
      throw new Error(
        "Public version or complete requested behavior unverified; inspect production evidence",
      );
    production.servedHead = pull.mergeSha;
    production.status = "verified";
    production.verifiedAt = this.factory.now();
    this.save(run);
    const origin = `<!-- app-foundry:${run.id}:production:${pull.mergeSha} -->`;
    const body = this.factory.clean(
      `${origin}\n## Producción comprobada\n\nEjecución: ${run.id}\nBase: ${run.workspace!.baseSha}\nCandidato aceptado: ${publication.integratedAcceptance!.head}\nCommit integrado: ${pull.mergeSha}\nPR: ${pull.url}\nDeployment: ${deployment.id} · ${deployment.environment} · ${deployment.projectId}\nDominio público: ${evidence.origin}\nSHA servido: ${evidence.servedHead}\nNavegador: ${evidence.browser}\n\n${evidence.checks.map((result) => `- [x] Criterio ${result.check.criterion}: ${result.check.path} ${result.check.selector} — ${result.observed}`).join("\n")}\n\nEvidencia persistida: ${partId}. La comprobación cubre las aserciones declaradas en la petición y revisadas con el candidato; no acredita comportamientos no expresados en ellas.`,
      55_000,
    );
    if (body.truncated)
      throw new Error("Production report exceeds evidence limit");
    const report = await this.effect(
      run,
      `production-report:${pull.mergeSha}`,
      async () => {
        const current = await this.facts(run, false);
        if (
          current.request.title !== run.request!.title ||
          current.request.body !== run.request!.body
        )
          throw new Error("Request changed before production report");
        return current.comments.find(
          (comment) => comment.source === "issue" && comment.body === body.text,
        );
      },
      () => this.production!.comment(this.context(run), body.text),
    );
    production.report = { id: report.id, url: report.url };
    if (!publication.ownComments.includes(report.id))
      publication.ownComments.push(report.id);
    this.save(run);
    await this.effect(
      run,
      `close-issue:${pull.mergeSha}`,
      async () => {
        const current = await this.facts(run, false);
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
        await this.production!.closeIssue(this.context(run));
        return true;
      },
    );
    production.closedAt = this.factory.now();
    run.status = "completed";
    run.endedAt = this.factory.now();
    run.error = null;
    this.factory.record(
      run,
      "completed",
      `Production ${pull.mergeSha} verified and evidence published: ${report.url}`,
    );
    this.save(run);
    this.factory.active = null;
  }

  private async advance() {
    const id = this.factory.active;
    const run = id ? this.factory.view(id) : null;
    if (
      !run?.request ||
      !run.workspace ||
      !run.verification?.headSha ||
      run.status === "stopped" ||
      run.status === "completed" ||
      (!run.publication && run.status !== "awaiting_preview")
    )
      return;
    run.publication ??= publicationPlan(run.verification.headSha);
    run.phase = "publication";
    const publication = run.publication;
    try {
      this.save(run);
      let facts = await this.facts(
        run,
        !publication.recoveryRequired && !publication.mergeSha,
      );
      this.factory.assertRunning(run.id);
      publication.observedAt = this.factory.now();
      publication.observationError = null;
      run.error = null;
      if (facts.pull) publication.pull = facts.pull;
      if (facts.preview) {
        publication.preview = facts.preview;
        if (
          !publication.deployments.some(
            (preview) =>
              JSON.stringify(preview.preview) === JSON.stringify(facts.preview),
          )
        )
          publication.deployments.push({
            at: this.factory.now(),
            preview: facts.preview,
          });
      }
      if (publication.recoveryRequired) {
        run.status = "intervention";
        run.error =
          "Efectos observados tras reinicio; la recuperación requiere intervención autorizada. No se reanuda la publicación.";
        for (const [key, confirmed] of [
          [`push:${publication.head}`, facts.remoteHead === publication.head],
          ["pull", Boolean(facts.pull)],
        ] as const) {
          if (confirmed && publication.operations[key]?.state === "intent") {
            publication.operations[key] = {
              state: "confirmed",
              at: this.factory.now(),
            };
            this.factory.record(
              run,
              "confirmed",
              `${key}: reconciled by observation after restart`,
            );
          }
        }
        this.save(run);
        if (facts.remoteHead === publication.head)
          await this.setStatus(run, "pending");
        return;
      }
      if (facts.pull?.merged) {
        await this.observeMerge(run, facts);
        return;
      }
      const intact =
        facts.request.title === run.request.title &&
        facts.request.body === run.request.body;
      if (!intact)
        publication.blocked =
          "Petición alterada o cerrada; se requiere intervención y una nueva autorización.";
      if (facts.pull && !facts.pull.open)
        publication.blocked =
          "PR cerrada sin integrar; se requiere intervención.";
      const changedHead = facts.pull?.head ?? facts.remoteHead;
      if (changedHead && changedHead !== publication.head) {
        delete publication.acceptance;
        delete publication.report;
        delete publication.preview;
        publication.head = changedHead;
        this.save(run);
        await this.setStatus(run, "pending");
        if (publication.blocked) throw new Error(publication.blocked);
        await this.effect(
          run,
          `prepare:${changedHead}`,
          async () => undefined,
          async () => {
            await this.port.prepareHead(this.context(run), changedHead);
            return true;
          },
        );
        run.status = "awaiting_verification";
        run.phase = "verification";
        this.factory.record(
          run,
          "candidate-invalidated",
          `New head ${changedHead}; checks, preview, report and acceptance required again`,
        );
        this.save(run);
        return;
      }
      if (publication.blocked) {
        delete publication.acceptance;
        this.save(run);
        await this.setStatus(run, "failure");
        throw new Error(publication.blocked);
      }
      this.evidence(run);
      const context = this.context(run);
      await this.effect(
        run,
        `push:${publication.head}`,
        async () => {
          const head = (await this.facts(run)).remoteHead;
          if (head && head !== publication.head)
            throw new Error("Remote head changed during publication");
          return head === publication.head ? true : undefined;
        },
        async () => {
          await this.port.push(context);
          return true;
        },
      );
      publication.pull = await this.effect(
        run,
        "pull",
        async () => (await this.facts(run)).pull ?? undefined,
        () => this.port.openPull(this.context(run)),
      );
      this.save(run);
      if (!publication.acceptance) await this.setStatus(run, "pending");
      facts = await this.facts(run);
      if (
        facts.pull?.head !== publication.head ||
        facts.request.title !== run.request.title ||
        facts.request.body !== run.request.body ||
        !facts.request.open
      )
        throw new Error(
          "Candidate or request changed during observation; acceptance blocked",
        );
      publication.preview = facts.preview ?? undefined;
      const previewValid = validPreview(
        facts.preview,
        publication.head,
        run.request.repository,
        context.project.publication.projectId,
        context.project.publication.previewEnvironment ?? "Preview",
      );
      if (!previewValid) {
        await this.setStatus(run, "pending");
        delete publication.acceptance;
        delete publication.report;
        run.status = "awaiting_preview";
        if (
          facts.preview?.state === "failure" ||
          facts.preview?.state === "error"
        ) {
          run.status = "intervention";
          run.error = `Deployment ${facts.preview.state}; preview no válida`;
        }
        this.save(run);
        return;
      }
      if (
        publication.report &&
        (publication.report.preview !== facts.preview!.url ||
          publication.report.head !== publication.head ||
          !this.reportIntact(run, facts))
      ) {
        await this.setStatus(run, "pending");
        delete publication.report;
        delete publication.acceptance;
      }
      if (!publication.report) await this.report(run);
      run.status = "awaiting_review";
      this.save(run);
      facts = await this.facts(run);
      for (const comment of facts.comments.toSorted(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
      )) {
        if (publication.consumed.some((entry) => entry.id === comment.id))
          continue;
        let reason = "Consulta sin aceptación";
        const own = this.isOwn(run, comment);
        if (own) reason = "Publicación propia o de bot";
        else {
          const intent = interpretComment(comment.body);
          if (
            intent.kind === "invalidate" &&
            (await this.port.canWrite(context.repository, comment.author))
          ) {
            delete publication.acceptance;
            publication.blocked =
              "Corrección o cancelación recibida; control revocado. Se requiere intervención.";
            reason = publication.blocked;
          } else if (intent.kind === "accept") {
            const report = publication.report!;
            if (comment.createdAt <= report.at)
              reason = "Aceptación anterior al informe";
            else if (comment.updatedAt !== comment.createdAt)
              reason = "Comentario editado; publica una instrucción nueva";
            else if (
              intent.head !== publication.head ||
              intent.preview !== report.preview
            )
              reason = "Aceptación de una versión o preview obsoleta";
            else if (
              !(await this.port.canWrite(context.repository, comment.author))
            )
              reason = "Permiso de escritura no acreditado";
            else {
              publication.acceptance = {
                commentId: comment.id,
                author: comment.author,
                at: comment.createdAt,
                head: intent.head,
                preview: intent.preview,
              };
              publication.acceptances.push(publication.acceptance);
              reason = "Aceptación del resultado acreditada";
            }
          } else if (intent.kind === "clarify") {
            reason = "Referencia ambigua; se requiere SHA y preview explícitos";
            await this.comment(
              run,
              `clarify:${comment.id}`,
              `La referencia no identifica un candidato aceptado. Para confirmar la versión vigente, publica un comentario nuevo:\n\n${fenced(`Acepto la versión ${publication.head} y su preview ${publication.report!.preview}.`)}`,
            );
          }
        }
        publication.consumed.push({ id: comment.id, reason });
        this.factory.record(
          run,
          "comment-consumed",
          `${comment.id}: ${reason}`,
        );
        this.save(run);
      }
      // Re-read the mutable facts and permissions immediately before publishing success.
      const final = await this.facts(run);
      const valid = await this.canMerge(run, final);
      await this.setStatus(
        run,
        valid ? "success" : publication.blocked ? "failure" : "pending",
      );
      if (!valid) delete publication.acceptance;
      run.status = publication.blocked
        ? "intervention"
        : valid
          ? "awaiting_merge"
          : "awaiting_review";
      run.error = publication.blocked ?? null;
      this.save(run);
    } catch (error) {
      let failure = error;
      if (error instanceof ObservedMerge) {
        try {
          await this.observeMerge(run, error.facts);
          return;
        } catch (mergeError) {
          failure = mergeError;
        }
      }
      this.factory.assertWritable();
      this.factory.assertRunning(run.id);
      const accepted = Boolean(publication.acceptance);
      publication.observationError = this.factory.clean(String(failure)).text;
      if (publication.production) {
        publication.production.status = "intervention";
        publication.production.error = publication.observationError;
      }
      run.error = publication.observationError;
      run.status = "intervention";
      this.factory.record(run, "publication-error", run.error);
      this.save(run);
      if (accepted) {
        try {
          await this.setStatus(run, "error");
        } catch (revocationError) {
          if (revocationError instanceof ObservedMerge) {
            try {
              await this.observeMerge(run, revocationError.facts);
              return;
            } catch (mergeError) {
              run.error = this.factory.clean(String(mergeError)).text;
            }
          }
          this.factory.assertWritable();
          this.factory.record(
            run,
            "revocation-unconfirmed",
            this.factory.clean(String(revocationError)).text,
          );
          this.save(run);
        }
      }
      delete publication.acceptance;
      this.save(run);
    }
  }
  async stop(id: string) {
    this.stopping = true;
    try {
      await this.busy;
      const run = this.factory.view(id);
      if (!run?.publication) return;
      delete run.publication.acceptance;
      run.publication.blocked =
        "Detención local solicitada; aceptación revocada.";
      run.status = "intervention";
      run.error = run.publication.blocked;
      this.save(run);
      this.stopping = false;
      await this.setStatus(run, "failure");
    } finally {
      this.stopping = false;
    }
  }
}
