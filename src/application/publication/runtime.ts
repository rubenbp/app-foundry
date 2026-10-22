import type { Factory } from "../factory.ts";
import { sanitizedRecord } from "../sanitize.ts";
import type { Run } from "../../domain/run.ts";
import type {
  PublicationContext,
  PublicationFacts,
  PublicationPort,
} from "./ports.ts";
import { readyToMerge, hasPendingReviewInstructions } from "./reviewPolicy.ts";
import { pullDescription } from "./description.ts";

class StatusSkippedAfterMerge extends Error {}
class ReviewInstructionReceived extends Error {}

/** A failed read is diagnostic evidence, not a request to notify the issue. */
export class PublicationObservationError extends Error {
  constructor(cause: unknown) {
    super(String(cause), { cause });
  }
}

export class ObservedMerge extends Error {
  readonly facts: PublicationFacts;

  constructor(facts: PublicationFacts) {
    super("Human merge observed during candidate publication");
    this.facts = facts;
  }
}

export class PublicationRuntime {
  readonly factory: Factory;
  readonly port: PublicationPort;
  stopping = false;

  constructor(factory: Factory, port: PublicationPort) {
    this.factory = factory;

    this.port = port;
  }

  save(run: Run) {
    this.factory.assertRunning(run.id);
    this.factory.persist({
      ...run,

      publication: sanitizedRecord(run.publication, this.factory.clean),
    });
  }

  context(run: Run): PublicationContext {
    return {
      repository: run.request!.repository,
      issue: run.request!.number,
      runId: run.id,
      head: run.publication!.head,
      previousHead: run.publication!.previousHead,
      project: run.request!.configuration,

      workspace: run.workspace!,
      pull: run.publication!.pull,
      description: pullDescription(run),
    };
  }

  beginPreviewWait(run: Run) {
    const publication = run.publication!;
    const previous = publication.previewWait;
    if (
      previous?.attempt === run.attempt &&
      previous.head === publication.head
    ) {
      return;
    }
    publication.previewWait = {
      attempt: run.attempt,
      head: publication.head,
      startedAt: this.factory.now(),
      state: "waiting",
    };
    this.factory.record(
      run,
      "preview-waiting",
      `Esperando preview · Intento ${run.attempt} · commit ${publication.head.slice(0, 7)}`,
    );
    this.save(run);
  }

  finishPreviewWait(run: Run, state: "ready" | "failed", reason?: string) {
    const wait = run.publication!.previewWait;
    if (
      !wait ||
      wait.head !== run.publication!.head ||
      wait.attempt !== run.attempt ||
      wait.state === state ||
      (state === "failed" && wait.state === "ready")
    ) {
      return;
    }
    wait.state = state;
    const seconds = Math.max(
      0,
      Math.floor((this.factory.now() - wait.startedAt) / 1000),
    );
    const label =
      state === "ready" ? "Preview listo" : "Error al comprobar preview";
    this.factory.record(
      run,
      state === "ready" ? "preview-ready" : "preview-error",
      `${label} · ${seconds} s · Intento ${wait.attempt} · commit ${wait.head.slice(0, 7)}${reason ? `\n${reason}` : ""}`,
    );
    this.save(run);
  }

  async effect<T>(
    run: Run,
    key: string,
    observe: () => Promise<T | undefined>,
    perform: () => Promise<T>,
    onConfirmed?: (result: T) => void,
  ): Promise<T> {
    this.factory.assertRunning(run.id);
    if (this.stopping) {
      throw new Error("Publication stopping; no new remote effects allowed");
    }
    // Consulta antes de cada reintento, incluso si se perdió la confirmación tras el éxito remoto.
    const found = await observe();
    this.factory.assertRunning(run.id);
    let result: T;
    if (found !== undefined) {
      result = found;
    } else {
      if (this.stopping) {
        throw new Error("Publication stopping; no new remote effects allowed");
      }
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
      // Persist the effect evidence together with its confirmation, including after reconciliation.
      onConfirmed?.(result);
      run.publication!.operations[key] = {
        state: "confirmed",
        at: this.factory.now(),
      };

      this.factory.record(run, "confirmed", key);
      this.save(run);
    }
    return result;
  }

  async facts(run: Run, preview = true) {
    let facts: PublicationFacts;
    const wait = preview ? run.publication!.previewWait : undefined;
    try {
      facts = await this.port.inspect(this.context(run), { preview });
    } catch (error) {
      this.factory.assertRunning(run.id);
      if (wait) {
        wait.lastCheckedAt = this.factory.now();
      }
      if (preview) {
        this.finishPreviewWait(run, "failed", String(error));
      }
      throw new PublicationObservationError(error);
    }
    if (wait) {
      wait.lastCheckedAt = this.factory.now();
      if (
        wait.state === "failed" &&
        facts.preview?.state !== "failure" &&
        facts.preview?.state !== "error"
      ) {
        wait.state = "waiting";
      }
      this.save(run);
    }
    // Cada lectura previa a la integración puede coincidir con la integración humana. Cambia de estado antes de
    // considerar que la PR cerrada o la vista previa retirada invalidan el candidato.
    if (
      facts.pull?.merged &&
      !run.publication!.acceptance &&
      !run.publication!.recoveryRequired
    ) {
      throw new ObservedMerge(facts);
    }
    return facts;
  }

  async setStatus(
    run: Run,
    state: "pending" | "success" | "failure" | "error",
  ) {
    const context = this.context(run);
    try {
      const confirmation = await this.effect(
        run,
        `status:${context.head}:${state}`,
        async () => {
          const facts = await this.facts(run, state === "success");
          if (facts.pull?.merged) {
            throw new StatusSkippedAfterMerge();
          }
          if (state === "success" && !readyToMerge(run, facts)) {
            if (hasPendingReviewInstructions(run, facts)) {
              throw new ReviewInstructionReceived();
            }
            throw new Error(
              "Candidate changed before favorable merge status; readiness revoked",
            );
          }
          const status = facts.status;

          return status?.head === context.head && status.state === state
            ? { at: status.at }
            : undefined;
        },
        () => this.port.status(context, state),
      );
      if (state === "success") {
        const publication = run.publication!;
        const report = publication.report!;
        // El merge y los estados usan el reloj de GitHub. Un registro local no
        // puede compararse con ellos: el reloj y la precisión pueden diferir.
        report.at = confirmation.at;
        publication.reports.find((entry) => entry.id === report.id)!.at =
          confirmation.at;
        this.save(run);
      }
    } catch (error) {
      if (error instanceof ReviewInstructionReceived) {
        await this.setStatus(run, "pending");
        return;
      }
      if (!(error instanceof StatusSkippedAfterMerge)) {
        throw error;
      }
      this.factory.record(
        run,
        "status-skipped",
        `${state}: PR already integrated; no status effect confirmed`,
      );
      this.save(run);
    }
  }

  async comment(
    run: Run,
    key: string,
    text: string,
    observed?: PublicationFacts,
  ) {
    const origin = `<!-- app-foundry:${run.id}:${key} -->`;
    const body = this.factory.clean(
      `${origin}\n${text}`,
      Number.MAX_SAFE_INTEGER,
    ).text;
    if (body.length > 60_000) {
      throw new Error("Publication comment exceeds GitHub limit");
    }
    const result = await this.effect(
      run,
      key,
      async () => {
        const facts = observed ?? (await this.facts(run, false));
        if (
          !facts.request.open ||
          facts.pull?.head !== run.publication!.head ||
          !facts.pull.open ||
          facts.pull.merged
        ) {
          throw new Error(
            "Request or PR changed before publishing review guidance",
          );
        }

        return facts.comments.find(
          (comment) => comment.source === "issue" && comment.body === body,
        );
      },
      () => this.port.commentIssue(this.context(run), body),
      (comment) => this.factory.recordIssueComment(run, comment),
    );
    if (!run.publication!.ownComments.includes(result.id)) {
      run.publication!.ownComments.push(result.id);
    }
    this.save(run);
    return result;
  }
}
