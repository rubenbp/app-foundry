import type { Run } from "../src/domain/run.ts";

export const phases = [
  "Cola",
  "Preparación",
  "Implementación",
  "Verificación",
  "Revisión",
  "Cierre",
] as const;

/** La fase observada permanece independiente de la navegación de sus detalles. */
export function currentPhase(run: Run): number {
  if (run.status === "queued") {
    return 0;
  }
  if (
    run.status === "completed" ||
    run.status === "closing_issue" ||
    run.publication?.mergeSha
  ) {
    return 5;
  }
  if (run.phase === "publication") {
    return 4;
  }
  if (run.phase === "verification") {
    return 3;
  }
  if (
    run.phase === "preparation" ||
    run.status === "preparing" ||
    run.status === "starting"
  ) {
    return 1;
  }
  return 2;
}

export function PhaseNavigation({ run }: { run: Run | null | undefined }) {
  const current = run ? currentPhase(run) : 0;

  return (
    <nav aria-label="Fases de la Ejecución" className="phase-navigation">
      <ol className="phases">
        {phases.map((phase, index) => (
          <li key={phase} aria-current={index === current ? "step" : undefined}>
            <span aria-hidden="true">{index < current ? "✓" : index + 1}</span>
            <span>
              {phase}
              <small>
                {index === current
                  ? "Actual"
                  : index < current
                    ? "Completada"
                    : "Pendiente"}
              </small>
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
