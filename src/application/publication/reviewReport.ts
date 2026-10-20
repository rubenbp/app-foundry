import type { Run } from "../../domain/run.ts";
import { randomUUID } from "node:crypto";
import type { PublicationRuntime } from "./runtime.ts";
import { assertCandidateEvidence } from "./evidence.ts";
import type { PublicationFacts } from "./ports.ts";

export class ReviewReport {
  private runtime: PublicationRuntime;

  constructor(runtime: PublicationRuntime) {
    this.runtime = runtime;
  }

  async describe(run: Run) {
    const publication = run.publication!;
    const key = `description:${publication.head}`;
    // Las ediciones humanas se conservan hasta la siguiente entrega de código.
    // Un PATCH incierto puede repetirse: sustituye los mismos campos y no crea recursos.
    if (publication.operations[key]?.state === "confirmed") {
      return;
    }
    publication.pull = await this.runtime.effect(
      run,
      key,
      async () => {
        const facts = await this.runtime.facts(run, false);
        if (
          !facts.request.open ||
          !facts.pull?.open ||
          facts.pull.head !== publication.head
        ) {
          throw new Error(
            "Request or candidate changed before updating the PR description",
          );
        }
        return undefined;
      },
      () => this.runtime.port.updatePull(this.runtime.context(run)),
    );
    this.runtime.save(run);
  }

  async notify(run: Run, facts: PublicationFacts) {
    const publication = run.publication!;
    const report = publication.report!;
    const unchanged = run.attemptBaseHead === publication.head;
    const result = run.attemptSummary ?? run.result ?? "";
    const guidance = unchanged
      ? `No se han realizado cambios en este Intento. Se conserva el Commit candidato anterior.\n\n${result}`
      : `El desarrollo está listo para validar.\n\n${result}\n\nPreview: ${report.preview}\nPR: ${publication.pull!.url}\n\nPara aceptar los cambios, revisa la preview y haz merge de la PR cuando sus controles sean favorables. No necesitas un comentario de aceptación.`;
    await this.runtime.comment(
      run,
      `attempt-result:${run.attempt}:${publication.preview!.id}`,
      `${guidance}\n\nPara pedir cambios, publica \`Corregir: instrucciones\` en este issue.`,
      facts,
    );
  }

  record(run: Run) {
    const publication = run.publication!;
    const preview = publication.preview!;
    assertCandidateEvidence(this.runtime.factory, run);
    // La evidencia técnica permanece en los artefactos locales del Dashboard.
    // Este registro vincula la revisión con la versión y preview comprobadas.
    publication.report = {
      id: randomUUID(),
      url: publication.pull!.url,
      at: this.runtime.factory.now(),
      head: publication.head,
      preview: preview.url!,
    };
    publication.reports.push(publication.report);
    this.runtime.save(run);
  }
}
