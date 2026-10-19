import type { Factory } from "./factory.ts";
import type { PublicationPort } from "./publication/ports.ts";
import {
  interpretComment,
  publicationPlan,
  validPreview,
} from "../domain/publication.ts";
import { PublicationRuntime, ObservedMerge } from "./publication/runtime.ts";
import { assertCandidateEvidence } from "./publication/evidence.ts";
import {
  isOwn,
  isInterventionResponse,
  readyToMerge,
} from "./publication/reviewPolicy.ts";
import { ReviewReport } from "./publication/reviewReport.ts";
import { IntegratedPublication } from "./publication/integration.ts";

export class CandidatePublication {
  private runtime: PublicationRuntime;
  private report: ReviewReport;
  private integration: IntegratedPublication;
  private busy?: Promise<void>;

  constructor(factory: Factory, port: PublicationPort) {
    this.runtime = new PublicationRuntime(factory, port);
    this.report = new ReviewReport(this.runtime);
    this.integration = new IntegratedPublication(this.runtime);
  }

  async poll() {
    if (this.busy) {
      return this.busy;
    }
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
      (run.phase !== "publication" && run.status !== "awaiting_preview") ||
      (!run.publication && run.status !== "awaiting_preview")
    ) {
      return;
    }
    run.publication ??= publicationPlan(run.verification.headSha);
    run.phase = "publication";
    const publication = run.publication;
    if (
      run.status === "awaiting_preview" &&
      run.verification.headSha !== publication.head
    ) {
      publication.previousHead = publication.head;
      publication.head = run.verification.headSha;
      delete publication.report;
      delete publication.preview;
    }
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
      if (facts.pull) {
        publication.pull = facts.pull;
      }
      if (facts.preview) {
        publication.preview = facts.preview;
        if (
          !publication.deployments.some(
            (preview) =>
              JSON.stringify(preview.preview) === JSON.stringify(facts.preview),
          )
        ) {
          publication.deployments.push({
            at: this.runtime.factory.now(),
            preview: facts.preview,
          });
        }
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
        if (facts.remoteHead === publication.head) {
          await this.runtime.setStatus(run, "pending");
        }
        return;
      }
      if (facts.pull?.merged) {
        await this.integration.advance(run, facts);
        return;
      }
      if (facts.pull && !facts.pull.open) {
        publication.blocked =
          "PR cerrada sin integrar; se requiere intervención.";
      }
      const changedHead = facts.pull?.head ?? facts.remoteHead;
      if (
        changedHead &&
        changedHead !== publication.head &&
        changedHead !== publication.previousHead
      ) {
        delete publication.report;
        delete publication.preview;
        publication.head = changedHead;
        this.runtime.save(run);
        await this.runtime.setStatus(run, "pending");
        if (publication.blocked) {
          throw new Error(publication.blocked);
        }
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
          `New head ${changedHead}; checks, preview and review report required again`,
        );
        this.runtime.save(run);
        return;
      }
      if (publication.blocked) {
        this.runtime.save(run);
        await this.runtime.setStatus(run, "failure");
        throw new Error(publication.blocked);
      }
      assertCandidateEvidence(this.runtime.factory, run);
      const context = this.runtime.context(run);
      await this.runtime.effect(
        run,
        `push:${publication.head}`,
        async () => {
          const head = (await this.runtime.facts(run)).remoteHead;
          if (
            head &&
            head !== publication.head &&
            head !== publication.previousHead
          ) {
            throw new Error("Remote head changed during publication");
          }
          return head === publication.head ? true : undefined;
        },
        async () => {
          await this.runtime.port.push(context);
          return true;
        },
      );
      delete publication.previousHead;
      publication.pull = await this.runtime.effect(
        run,
        "pull",
        async () => (await this.runtime.facts(run)).pull ?? undefined,
        async () => {
          const pull = await this.runtime.port.openPull(
            this.runtime.context(run),
          );
          publication.operations[`description:${publication.head}`] = {
            state: "confirmed",
            at: this.runtime.factory.now(),
          };
          return pull;
        },
      );
      this.runtime.save(run);
      await this.report.describe(run);
      if (!publication.report) {
        await this.runtime.setStatus(run, "pending");
      }
      facts = await this.runtime.facts(run);
      if (facts.pull?.head !== publication.head || !facts.request.open) {
        throw new Error(
          "Candidate or request changed during observation; acceptance blocked",
        );
      }
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
        delete publication.report;
        run.status = "awaiting_preview";
        if (
          facts.preview?.state === "failure" ||
          facts.preview?.state === "error"
        ) {
          run.status = "intervention";
          run.error = `El deployment está en estado «${facts.preview.state}»; la vista previa no es válida.`;
        }
        this.runtime.save(run);
        return;
      }
      if (
        publication.report &&
        (publication.report.preview !== facts.preview!.url ||
          publication.report.head !== publication.head)
      ) {
        await this.runtime.setStatus(run, "pending");
        delete publication.report;
      }
      if (!publication.report) {
        this.report.record(run);
      }
      run.status = "awaiting_review";
      this.runtime.save(run);
      facts = await this.runtime.facts(run);
      for (const comment of facts.comments.toSorted(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
      )) {
        if (publication.consumed.some((entry) => entry.id === comment.id)) {
          continue;
        }
        let reason =
          "Comentario informativo; la aceptación se realiza mediante merge";
        const own = isOwn(run, comment);
        if (isInterventionResponse(run, comment)) {
          reason = "Aclaración ya entregada a la conversación del agente";
        } else if (own) {
          reason = "Publicación propia o de bot";
        } else {
          const intent = interpretComment(comment.body);
          if (
            intent.kind === "invalidate" &&
            (await this.runtime.port.canWrite(
              context.repository,
              comment.author,
            ))
          ) {
            publication.blocked =
              "Corrección o cancelación recibida; control revocado. Se requiere intervención.";
            reason = publication.blocked;
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
      // Vuelve a leer los datos mutables justo antes de publicar el éxito.
      const final = await this.runtime.facts(run);
      const valid = readyToMerge(run, final);
      if (valid) {
        await this.report.notify(run);
      }
      await this.runtime.setStatus(
        run,
        valid ? "success" : publication.blocked ? "failure" : "pending",
      );
      run.status = publication.blocked
        ? "intervention"
        : valid
          ? "awaiting_review"
          : "awaiting_preview";
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
      const wasReady = Boolean(
        publication.operations[`status:${publication.head}:success`],
      );
      publication.observationError = this.runtime.factory.clean(
        String(failure),
      ).text;
      run.error = `Falló la observación o publicación. Detalle: ${publication.observationError}`;
      run.status = "intervention";
      this.runtime.factory.record(run, "publication-error", run.error);
      this.runtime.save(run);
      if (wasReady) {
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

      this.runtime.save(run);
    }
  }

  async isMerged(id: string) {
    const run = this.runtime.factory.view(id)!;
    if (!run.publication) {
      return false;
    }
    const facts = await this.runtime.port.inspect(this.runtime.context(run), {
      preview: false,
    });
    this.runtime.factory.assertRunning(id);
    if (facts.pull) {
      run.publication.pull = facts.pull;
    }
    this.runtime.save(run);
    return Boolean(facts.pull?.merged || run.publication.mergeSha);
  }

  async invalidate(id: string) {
    const run = this.runtime.factory.view(id)!;
    if (!run.publication) {
      return;
    }
    delete run.publication.report;
    delete run.publication.preview;
    delete run.publication.blocked;
    delete run.publication.recoveryRequired;
    this.runtime.save(run);
    await this.runtime.setStatus(run, "pending");
  }

  async retry(id: string) {
    let run = this.runtime.factory.view(id)!;
    if (!run.publication) {
      throw new Error("Publication context required");
    }
    if (!run.publication.pull?.merged && !run.publication.mergeSha) {
      await this.invalidate(id);
      run = this.runtime.factory.view(id)!;
    } else {
      delete run.publication.recoveryRequired;
      this.runtime.save(run);
    }
    run.status = run.publication!.mergeSha
      ? "closing_issue"
      : "awaiting_preview";
    run.error = null;
    this.runtime.save(run);
  }

  async stop(id: string) {
    this.runtime.stopping = true;
    try {
      await this.busy;
      const run = this.runtime.factory.view(id);
      if (!run?.publication) {
        return;
      }
      run.publication.blocked =
        "Detención local solicitada; control de merge revocado.";
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
