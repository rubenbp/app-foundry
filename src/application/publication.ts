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
} from "../domain/publication.ts";

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

export class CandidatePublication {
  private factory: Factory;
  private port: PublicationPort;
  private busy?: Promise<void>;
  private stopping = false;
  constructor(factory: Factory, port: PublicationPort) {
    this.factory = factory;
    this.port = port;
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
    return this.port.inspect(this.context(run), { preview });
  }
  private isOwn(run: Run, comment: ConversationComment) {
    return (
      run.publication!.ownComments.includes(comment.id) ||
      comment.body.includes("<!-- app-foundry:") ||
      !comment.human
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
    const unchangedReport = facts.comments.some(
      (comment) =>
        comment.id === report.id &&
        createHash("sha256").update(comment.body).digest("hex") ===
          report.bodyHash,
    );
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
    await this.effect(
      run,
      `status:${context.head}:${state}`,
      async () => {
        const facts = await this.facts(run, state === "success");
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
    };
    publication.reports.push(publication.report);
    this.save(run);
  }
  private async advance() {
    const id = this.factory.active;
    const run = id ? this.factory.view(id) : null;
    if (
      !run?.request ||
      !run.workspace ||
      !run.verification?.headSha ||
      run.status === "stopped" ||
      (!run.publication && run.status !== "awaiting_preview")
    )
      return;
    run.publication ??= publicationPlan(run.verification.headSha);
    run.phase = "publication";
    const publication = run.publication;
    try {
      this.save(run);
      let facts = await this.facts(run);
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
      const intact =
        facts.request.open &&
        facts.request.title === run.request.title &&
        facts.request.body === run.request.body;
      if (!intact)
        publication.blocked =
          "Petición alterada o cerrada; se requiere intervención y una nueva autorización.";
      if (facts.pull?.merged) {
        publication.mergeSha = facts.pull.mergeSha;
        publication.blocked =
          publication.acceptance &&
          facts.pull.head === publication.acceptance.head
            ? "Merge humano observado; comprobación de producción pendiente del siguiente incremento."
            : "Incidencia: merge externo sin aceptación vigente acreditada.";
      } else if (facts.pull && !facts.pull.open)
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
        delete publication.acceptance;
        delete publication.report;
        await this.setStatus(run, "pending");
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
          !facts.comments.some(
            (comment) =>
              comment.id === publication.report!.id &&
              createHash("sha256").update(comment.body).digest("hex") ===
                publication.report!.bodyHash,
          ))
      ) {
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
      if (!valid) delete publication.acceptance;
      await this.setStatus(
        run,
        valid ? "success" : publication.blocked ? "failure" : "pending",
      );
      run.status = publication.blocked
        ? "intervention"
        : valid
          ? "awaiting_merge"
          : "awaiting_review";
      run.error = publication.blocked ?? null;
      this.save(run);
    } catch (error) {
      this.factory.assertWritable();
      this.factory.assertRunning(run.id);
      const accepted = Boolean(publication.acceptance);
      delete publication.acceptance;
      publication.observationError = this.factory.clean(String(error)).text;
      run.error = publication.observationError;
      run.status = "intervention";
      this.factory.record(run, "publication-error", run.error);
      this.save(run);
      if (accepted) {
        try {
          await this.setStatus(run, "error");
        } catch (revocationError) {
          this.factory.assertWritable();
          this.factory.record(
            run,
            "revocation-unconfirmed",
            this.factory.clean(String(revocationError)).text,
          );
          this.save(run);
        }
      }
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
