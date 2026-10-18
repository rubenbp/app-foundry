import type { Factory } from "../factory.ts";
import type { Run } from "../../domain/run.ts";

export function candidateEvidence(factory: Factory, run: Run) {
  const verification = run.verification!;
  const output = (id: string) => {
    const part = run.parts.find((part) => part.id === id);
    const text = factory.output(run.id, id);
    if (!part || part.truncated || text === null) {
      throw new Error(`Complete evidence missing: ${id}`);
    }
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
  ) {
    throw new Error(
      "Valid complete technical evidence for the current head required",
    );
  }
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
