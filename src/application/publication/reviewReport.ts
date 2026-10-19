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

  async notify(run: Run) {
    const publication = run.publication!;
    const report = publication.report!;
    await this.runtime.comment(
      run,
      `review-ready:${report.id}`,
      `El desarrollo está listo para validar.\n\nPreview: ${report.preview}\nPR e informe: ${publication.pull!.url}\n\nPara aceptar los cambios, revisa la preview y haz merge de la PR cuando sus controles sean favorables. No necesitas un comentario de aceptación.\n\nPara pedir cambios, publica \`Corregir: instrucciones\` en este issue.`,
      "issue",
    );
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
      // Divide por unidades de código UTF-16 sin separar un par sustituto.
      for (let start = 0, index = 1; start < evidence.length; index++) {
        let end = Math.min(start + 20_000, evidence.length);
        if (
          end < evidence.length &&
          /[\uD800-\uDBFF]/.test(evidence[end - 1])
        ) {
          end--;
        }
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
      `## Informe de revisión de la Factory\n\nIssue: ${run.request!.url}\nEjecución: ${run.id}\nBase: ${run.verification!.baseSha}\nHead: ${publication.head}\nDiff acumulado: https://github.com/${run.request!.repository}/compare/${run.verification!.baseSha}...${publication.head}\nPreview: ${preview.url}\nDeployment: ${preview.id} · ${preview.environment} · ${preview.projectId}\n\n${details}\n\n### Limitaciones\n\n${[...run.verification!.limitations, ...publication.limitations].map((line) => `- ${line}`).join("\n")}\n\n### Decisión humana\n\nRevisa la preview y la evidencia de cada criterio. Para aceptar los cambios, haz merge de esta PR cuando Factory / ready-to-merge sea favorable. No necesitas un comentario de aceptación.\n\nPara pedir cambios, publica \`Corregir: instrucciones\` en el issue; para detener el trabajo, publica \`Cancelar\`. La Factory no hace merge por su cuenta.`,
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
