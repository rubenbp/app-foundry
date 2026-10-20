import type { FactoryView } from "../src/application/factoryView.ts";
import type { Run } from "../src/domain/run.ts";
import { age, time, dateTime } from "./format.ts";

export function ObservationsDetails({
  run,
  view,
  lastLocal,
  now,
}: {
  run: Run;
  view: FactoryView;
  lastLocal: number | null;
  now: number;
}) {
  return (
    <>
      <details className="card provenance">
        <summary>Observación y procedencia</summary>
        <dl className="usage">
          <div>
            <dt>Servidor local</dt>
            <dd>
              {age(lastLocal, now)} · {time(lastLocal)}
            </dd>
          </div>
          <div>
            <dt>OpenCode</dt>
            <dd>
              {age(run.lastObservation, now)} · {time(run.lastObservation)}
            </dd>
          </div>
          <div>
            <dt>Actividad del agente</dt>
            <dd>
              {age(run.lastActivity, now)} · {time(run.lastActivity)}
            </dd>
          </div>
          <div>
            <dt>Inicio</dt>
            <dd>{dateTime(run.startedAt)}</dd>
          </div>
          <div>
            <dt>Estado del agente</dt>
            <dd>{run.agentStatus ?? "No observado"}</dd>
          </div>
        </dl>
        <p>{view?.consumption?.source}</p>
        <p>Cobertura: {view?.consumption?.coverage ?? "No disponible"}</p>
        <p>
          El resultado requiere verificación independiente. El estado idle y el
          texto del agente no acreditan éxito.
        </p>
      </details>
      <details className="card provenance">
        <summary>Configuración, procesos y lagunas</summary>
        <dl className="usage">
          <div>
            <dt>Sesión OpenCode</dt>
            <dd>{run.sessionId ?? "No registrada"}</dd>
          </div>
          <div>
            <dt>Proceso propio</dt>
            <dd>
              {run.process
                ? `PID ${run.process.pid} · ${run.process.exited ? "Ausencia comprobada o salida observada" : "Sin confirmar detención"}`
                : "No registrado"}
            </dd>
          </div>
        </dl>
        <pre tabIndex={0}>
          {JSON.stringify(run.process?.configuration ?? {}, null, 2)}
        </pre>
        <ul>
          {run.gaps.map((gap, i) => (
            <li key={i}>{gap}</li>
          ))}
        </ul>
      </details>
      {view?.source ? (
        <details className="card">
          <summary>Entrada de GitHub</summary>
          <p>
            Última consulta correcta: {time(view.admission.lastSuccess)} ·{" "}
            {age(view.admission.lastSuccess, now)}
          </p>
          {view.admission.error ? (
            <p className="notice danger" role="alert">
              {view.admission.error}
            </p>
          ) : null}
          <a href={view.source} target="_blank" rel="noreferrer">
            Revisar autorización en GitHub ↗
          </a>
        </details>
      ) : null}
    </>
  );
}
