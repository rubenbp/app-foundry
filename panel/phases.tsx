import type { Run } from "../src/domain/run.ts";

/** Order, label and context share the same phase identity. */
export const phases = [
  {
    id: "queue",
    label: "Cola",
    context: "El encargo espera su turno en la cola.",
  },
  {
    id: "preparation",
    label: "Preparación",
    context:
      "La Factory prepara la versión de partida y captura las instrucciones del Managed project.",
  },
  {
    id: "implementation",
    label: "Implementación",
    context:
      "El agente trabaja en el encargo autorizado. Su resultado requiere verificación independiente.",
  },
  {
    id: "verification",
    label: "Verificación",
    context: "Comprobaciones independientes del Commit candidato.",
  },
  {
    id: "review",
    label: "Revisión",
    context: "Preview, PR y aceptación humana del resultado.",
  },
  {
    id: "closure",
    label: "Cierre",
    context: "Integración del resultado aceptado y cierre del issue.",
  },
] as const;

export type Phase = (typeof phases)[number]["id"];

export function phaseDetails(phase: Phase) {
  return phases.find(({ id }) => id === phase)!;
}

/** La fase observada permanece independiente de la navegación de sus detalles. */
export function currentPhase(run: Run): Phase {
  if (run.status === "queued") {
    return "queue";
  }
  if (
    run.status === "completed" ||
    run.status === "closing_issue" ||
    run.publication?.mergeSha
  ) {
    return "closure";
  }
  if (run.phase === "publication") {
    return "review";
  }
  if (run.phase === "verification") {
    return "verification";
  }
  if (
    run.phase === "preparation" ||
    run.status === "preparing" ||
    run.status === "starting"
  ) {
    return "preparation";
  }
  return "implementation";
}

export function PhaseNavigation({
  run,
  consulted,
  onSelect,
  onCurrent,
}: {
  run: Run | null | undefined;
  consulted: Phase;
  onSelect: (phase: Phase) => void;
  onCurrent: () => void;
}) {
  const current = run ? currentPhase(run) : null;
  const currentPosition = phases.findIndex(({ id }) => id === current);

  return (
    <nav aria-label="Fases de la Ejecución" className="phase-navigation">
      <ol className="phases">
        {phases.map(({ id, label }, index) => (
          <li key={id} aria-current={id === current ? "step" : undefined}>
            <button
              type="button"
              aria-pressed={Boolean(run) && consulted === id}
              disabled={!run}
              onClick={() => onSelect(id)}
            >
              <span aria-hidden="true">
                {current !== null && index < currentPosition ? "✓" : index + 1}
              </span>
              <span>
                {label}
                <small>
                  {current === null
                    ? "Sin Ejecución"
                    : id === current
                      ? "Actual"
                      : index < currentPosition
                        ? "Completada"
                        : "Pendiente"}
                  {run && consulted === id ? " · Consultada" : ""}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {run && consulted !== current ? (
        <button className="return-phase" onClick={onCurrent}>
          Volver a la fase actual
        </button>
      ) : null}
    </nav>
  );
}
