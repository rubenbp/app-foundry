import type { VerificationCheck } from "../src/domain/verification.ts";
import { time } from "./format.ts";

const checkLabels = {
  not_run: "No ejecutada",
  running: "En ejecución",
  passed: "Aprobada",
  failed: "Fallida",
  uncertain: "Ejecución sin confirmar",
};
export function CompactVerificationCheck({
  check,
  hasOutput,
}: {
  check: VerificationCheck;
  hasOutput: boolean;
}) {
  const duration =
    check.startedAt !== null && check.endedAt !== null
      ? `${((check.endedAt - check.startedAt) / 1000).toLocaleString("es-ES", {
          maximumFractionDigits: 1,
        })} s`
      : null;
  const processesUnconfirmed =
    check.cleanup === "uncertain" || check.cleanup === "pending";

  return (
    <li className="verification-compact-check">
      <div className="verification-check-summary">
        <strong>{check.command}</strong>
        <span className={`verification-check-result ${check.status}`}>
          {checkLabels[check.status]}
        </span>
        {duration ? (
          <span className="verification-check-duration">{duration}</span>
        ) : null}
        {hasOutput ? (
          <a
            href={`#part-${check.partId}`}
            aria-label={`Consultar salida de ${check.command}`}
          >
            Salida ↗
          </a>
        ) : null}
      </div>
      {processesUnconfirmed ? (
        <p className="verification-process-warning" role="status">
          {check.cleanup === "uncertain"
            ? "No se pudo confirmar que todos los procesos del comando terminaran."
            : "La finalización de los procesos del comando aún no está confirmada."}
        </p>
      ) : null}
      {!hasOutput ? (
        <p className="small muted">Salida ausente; no acredita aprobación.</p>
      ) : null}
      <details className="verification-check-technical">
        <summary>Detalles técnicos</summary>
        <dl>
          <div>
            <dt>Código de salida</dt>
            <dd>{check.code ?? "No observado"}</dd>
          </div>
          <div>
            <dt>Inicio</dt>
            <dd>{time(check.startedAt)}</dd>
          </div>
          <div>
            <dt>Fin</dt>
            <dd>{time(check.endedAt)}</dd>
          </div>
        </dl>
        <p>
          {check.cleanup === "confirmed"
            ? "El comando ha terminado y sus comprobaciones de cierre han pasado."
            : check.cleanup === "not_started" || !check.cleanup
              ? "No se ha iniciado un proceso para esta comprobación."
              : "Falta confirmar que todos los procesos del comando han terminado."}
        </p>
        {check.executedCommand && check.executedCommand !== check.command ? (
          <pre>{check.executedCommand}</pre>
        ) : null}
      </details>
    </li>
  );
}
