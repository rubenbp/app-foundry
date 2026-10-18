import { createHash } from "node:crypto";
import type { Run } from "../../domain/run.ts";
import { fenced } from "../../domain/publication.ts";
import type { PublicationRuntime } from "./runtime.ts";
import { candidateEvidence } from "./evidence.ts";

export class ReviewReport {
  private runtime: PublicationRuntime;
  constructor(runtime: PublicationRuntime) {
    this.runtime = runtime;
  }
  async publish(run: Run) {
    const publication = run.publication!;
    const preview = publication.preview!;
    const evidence = candidateEvidence(this.runtime.factory, run);
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
        const comment = await this.runtime.comment(
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
    const comment = await this.runtime.comment(
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
    this.runtime.save(run);
  }
}
