import type { Run } from "../src/domain/run.ts";
import { phases } from "./phases.tsx";
import { VerificationDetails } from "./verification.tsx";
import { PublicationDetails } from "./publication.tsx";
import { IntegrationDetails } from "./integration.tsx";

/** Only the consulted phase contributes its context; current alerts live outside. */
export function PhaseContext({
  run,
  phase,
  onCode,
}: {
  run: Run;
  phase: number;
  onCode: () => void;
}) {
  return (
    <>
      <section
        className="card phase-context"
        aria-label={`Contexto de ${phases[phase]}`}
      >
        <h2>{phases[phase]}</h2>
        <p>
          {phase === 0
            ? "El encargo espera su turno en la cola."
            : phase === 1
              ? "La Factory prepara la versión de partida y captura las instrucciones del Managed project."
              : phase === 2
                ? "El agente trabaja en el encargo autorizado. Su resultado requiere verificación independiente."
                : phase === 3
                  ? "Comprobaciones independientes del Commit candidato."
                  : phase === 4
                    ? "Preview, PR y aceptación humana del resultado."
                    : "Integración del resultado aceptado y cierre del issue."}
        </p>
        <button
          className="button button-outline"
          aria-haspopup="dialog"
          onClick={onCode}
        >
          Código de la Ejecución
        </button>
        {phase === 3 && run.verification ? (
          <p>
            <a href="#verification-title" aria-haspopup="dialog">
              Verificación y evidencias
            </a>
          </p>
        ) : null}
      </section>
      {phase === 3 ? (
        run.verification ? (
          <VerificationDetails run={run} />
        ) : (
          <p className="card">Sin informe de verificación disponible.</p>
        )
      ) : null}
      {phase === 4 ? (
        run.publication ? (
          <PublicationDetails run={run} />
        ) : (
          <p className="card">Sin publicación observada todavía.</p>
        )
      ) : null}
      {phase === 5 ? (
        run.publication?.mergeSha ? (
          <IntegrationDetails run={run} />
        ) : (
          <p className="card">Sin integración observada todavía.</p>
        )
      ) : null}
    </>
  );
}
