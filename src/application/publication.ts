import type { Factory } from "./factory.ts";
import type { PublicationPort, ProductionPort } from "./publication/ports.ts";
import {
  fenced,
  interpretComment,
  publicationPlan,
  validPreview,
} from "../domain/publication.ts";
import { PublicationRuntime, ObservedMerge } from "./publication/runtime.ts";
import { candidateEvidence } from "./publication/evidence.ts";
import { isOwn, reportIntact, canMerge } from "./publication/reviewPolicy.ts";
import { ReviewReport } from "./publication/reviewReport.ts";
import { IntegratedPublication } from "./publication/production.ts";

export class CandidatePublication {
  private runtime: PublicationRuntime;
  private report: ReviewReport;
  private integration: IntegratedPublication;
  private busy?: Promise<void>;
  constructor(
    factory: Factory,
    port: PublicationPort,
    production?: ProductionPort,
  ) {
    this.runtime = new PublicationRuntime(factory, port);
    this.report = new ReviewReport(this.runtime);
    this.integration = new IntegratedPublication(this.runtime, production);
  }
  async poll() {
    if (this.busy) return this.busy;
    this.busy = this.advance().finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }
  private async advance() {
    const id = this.runtime.factory.active;
    const run = id ? this.runtime.factory.view(id) : null;
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
      this.runtime.save(run);
      let facts = await this.runtime.facts(
        run,
        !publication.recoveryRequired && !publication.mergeSha,
      );
      this.runtime.factory.assertRunning(run.id);
      publication.observedAt = this.runtime.factory.now();
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
            at: this.runtime.factory.now(),
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
              at: this.runtime.factory.now(),
            };
            this.runtime.factory.record(
              run,
              "confirmed",
              `${key}: reconciled by observation after restart`,
            );
          }
        }
        this.runtime.save(run);
        if (facts.remoteHead === publication.head)
          await this.runtime.setStatus(run, "pending");
        return;
      }
      if (facts.pull?.merged) {
        await this.integration.advance(run, facts);
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
        this.runtime.save(run);
        await this.runtime.setStatus(run, "pending");
        if (publication.blocked) throw new Error(publication.blocked);
        await this.runtime.effect(
          run,
          `prepare:${changedHead}`,
          async () => undefined,
          async () => {
            await this.runtime.port.prepareHead(
              this.runtime.context(run),
              changedHead,
            );
            return true;
          },
        );
        run.status = "awaiting_verification";
        run.phase = "verification";
        this.runtime.factory.record(
          run,
          "candidate-invalidated",
          `New head ${changedHead}; checks, preview, report and acceptance required again`,
        );
        this.runtime.save(run);
        return;
      }
      if (publication.blocked) {
        delete publication.acceptance;
        this.runtime.save(run);
        await this.runtime.setStatus(run, "failure");
        throw new Error(publication.blocked);
      }
      candidateEvidence(this.runtime.factory, run);
      const context = this.runtime.context(run);
      await this.runtime.effect(
        run,
        `push:${publication.head}`,
        async () => {
          const head = (await this.runtime.facts(run)).remoteHead;
          if (head && head !== publication.head)
            throw new Error("Remote head changed during publication");
          return head === publication.head ? true : undefined;
        },
        async () => {
          await this.runtime.port.push(context);
          return true;
        },
      );
      publication.pull = await this.runtime.effect(
        run,
        "pull",
        async () => (await this.runtime.facts(run)).pull ?? undefined,
        () => this.runtime.port.openPull(this.runtime.context(run)),
      );
      this.runtime.save(run);
      if (!publication.acceptance) await this.runtime.setStatus(run, "pending");
      facts = await this.runtime.facts(run);
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
        await this.runtime.setStatus(run, "pending");
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
        this.runtime.save(run);
        return;
      }
      if (
        publication.report &&
        (publication.report.preview !== facts.preview!.url ||
          publication.report.head !== publication.head ||
          !reportIntact(run, facts))
      ) {
        await this.runtime.setStatus(run, "pending");
        delete publication.report;
        delete publication.acceptance;
      }
      if (!publication.report) await this.report.publish(run);
      run.status = "awaiting_review";
      this.runtime.save(run);
      facts = await this.runtime.facts(run);
      for (const comment of facts.comments.toSorted(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
      )) {
        if (publication.consumed.some((entry) => entry.id === comment.id))
          continue;
        let reason = "Consulta sin aceptación";
        const own = isOwn(run, comment);
        if (own) reason = "Publicación propia o de bot";
        else {
          const intent = interpretComment(comment.body);
          if (
            intent.kind === "invalidate" &&
            (await this.runtime.port.canWrite(
              context.repository,
              comment.author,
            ))
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
              !(await this.runtime.port.canWrite(
                context.repository,
                comment.author,
              ))
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
            await this.runtime.comment(
              run,
              `clarify:${comment.id}`,
              `La referencia no identifica un candidato aceptado. Para confirmar la versión vigente, publica un comentario nuevo:\n\n${fenced(`Acepto la versión ${publication.head} y su preview ${publication.report!.preview}.`)}`,
            );
          }
        }
        publication.consumed.push({ id: comment.id, reason });
        this.runtime.factory.record(
          run,
          "comment-consumed",
          `${comment.id}: ${reason}`,
        );
        this.runtime.save(run);
      }
      // Re-read the mutable facts and permissions immediately before publishing success.
      const final = await this.runtime.facts(run);
      const valid = await canMerge(run, final, this.runtime.port);
      await this.runtime.setStatus(
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
      this.runtime.save(run);
    } catch (error) {
      let failure = error;
      if (error instanceof ObservedMerge) {
        try {
          await this.integration.advance(run, error.facts);
          return;
        } catch (mergeError) {
          failure = mergeError;
        }
      }
      this.runtime.factory.assertWritable();
      this.runtime.factory.assertRunning(run.id);
      const accepted = Boolean(publication.acceptance);
      publication.observationError = this.runtime.factory.clean(
        String(failure),
      ).text;
      if (publication.production) {
        publication.production.status = "intervention";
        publication.production.error = publication.observationError;
      }
      run.error = publication.observationError;
      run.status = "intervention";
      this.runtime.factory.record(run, "publication-error", run.error);
      this.runtime.save(run);
      if (accepted) {
        try {
          await this.runtime.setStatus(run, "error");
        } catch (revocationError) {
          if (revocationError instanceof ObservedMerge) {
            try {
              await this.integration.advance(run, revocationError.facts);
              return;
            } catch (mergeError) {
              run.error = this.runtime.factory.clean(String(mergeError)).text;
            }
          }
          this.runtime.factory.assertWritable();
          this.runtime.factory.record(
            run,
            "revocation-unconfirmed",
            this.runtime.factory.clean(String(revocationError)).text,
          );
          this.runtime.save(run);
        }
      }
      delete publication.acceptance;
      this.runtime.save(run);
    }
  }
  async stop(id: string) {
    this.runtime.stopping = true;
    try {
      await this.busy;
      const run = this.runtime.factory.view(id);
      if (!run?.publication) return;
      delete run.publication.acceptance;
      run.publication.blocked =
        "Detención local solicitada; aceptación revocada.";
      run.status = "intervention";
      run.error = run.publication.blocked;
      this.runtime.save(run);
      this.runtime.stopping = false;
      await this.runtime.setStatus(run, "failure");
    } finally {
      this.runtime.stopping = false;
    }
  }
}
