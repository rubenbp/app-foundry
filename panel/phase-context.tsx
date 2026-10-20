import type { Run } from "../src/domain/run.ts";
import { phaseDetails, type Phase } from "./phases.tsx";
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
  phase: Phase;
  onCode: () => void;
}) {
  const details = phaseDetails(phase);

  return (
    <>
      <section
        className="card phase-context"
        aria-label={`Contexto de ${details.label}`}
      >
        <h2>{details.label}</h2>
        <p>{details.context}</p>
        <button
          className="button button-outline"
          aria-haspopup="dialog"
          onClick={onCode}
        >
          Código de la Ejecución
        </button>
        {phase === "verification" && run.verification ? (
          <p>
            <a href="#verification-title" aria-haspopup="dialog">
              Verificación y evidencias
            </a>
          </p>
        ) : null}
      </section>
      {phase === "verification" ? (
        run.verification ? (
          <VerificationDetails run={run} />
        ) : (
          <p className="card">Sin informe de verificación disponible.</p>
        )
      ) : null}
      {phase === "review" ? (
        run.publication ? (
          <PublicationDetails run={run} />
        ) : (
          <p className="card">Sin publicación observada todavía.</p>
        )
      ) : null}
      {phase === "closure" ? (
        run.publication ? (
          <IntegrationDetails run={run} />
        ) : (
          <p className="card">Sin integración observada todavía.</p>
        )
      ) : null}
    </>
  );
}
