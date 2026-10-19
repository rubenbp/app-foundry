import type { Run } from "../src/domain/run.ts";

const checkLabels = {
  not_run: "No ejecutada",
  running: "En ejecución",
  passed: "Aprobada",
  failed: "Fallida",
  uncertain: "Ejecución sin confirmar",
};
const cleanupLabels = {
  not_started: "Sin proceso iniciado",
  pending: "Limpieza pendiente de confirmar",
  confirmed: "Limpieza confirmada",
  uncertain: "Limpieza incierta",
};

export function VerificationDetails({ run }: { run: Run }) {
  const report = run.verification;
  if (!report) {
    return null;
  }
  const repository = run.request?.repository;

  return (
    <section className="card verification" aria-labelledby="verification-title">
      <h2 id="verification-title">Verificación independiente</h2>
      <p>Árbol completo del Commit candidato y diff acumulado desde la base.</p>
      <dl className="usage">
        <div>
          <dt>Base</dt>
          <dd>{report.baseSha}</dd>
        </div>
        <div>
          <dt>Head fijado tras detener la edición</dt>
          <dd>{report.headSha ?? "Sin fijar"}</dd>
        </div>
      </dl>
      <p className="evidence-links">
        <a href={`#part-${report.diffPartId}`}>Salida del diff acumulado</a>
        {" · "}
        <a href={`#part-${report.configurationPartId}`}>
          Configuración y alcance
        </a>
        {repository && report.headSha ? (
          <>
            {" · "}
            <a
              href={`https://github.com/${repository}/compare/${report.baseSha}...${report.headSha}`}
              target="_blank"
              rel="noreferrer"
            >
              Revisar diff acumulado en GitHub
            </a>
          </>
        ) : null}
      </p>
      <h3>Comprobaciones</h3>
      <ol className="verification-checks">
        {report.checks.map((check) => (
          <li key={check.partId}>
            <strong>{check.command}</strong>
            <p>
              {checkLabels[check.status]} · Código de salida:{" "}
              {check.code ?? "No observado"}
            </p>
            <p className="small muted">
              Grupo del comando: {check.pid ?? "No observado"}
            </p>
            <p className="small muted">
              {cleanupLabels[check.cleanup ?? "not_started"]}
            </p>
            {check.executedCommand &&
            check.executedCommand !== check.command ? (
              <pre>{check.executedCommand}</pre>
            ) : null}
            {check.startedAt ? (
              <p className="small muted">
                Inicio: {new Date(check.startedAt).toLocaleTimeString("es-ES")}{" "}
                · Fin:{" "}
                {check.endedAt
                  ? new Date(check.endedAt).toLocaleTimeString("es-ES")
                  : "Sin confirmar"}
              </p>
            ) : null}
            {run.parts.some((part) => part.id === check.partId) ? (
              <a href={`#part-${check.partId}`}>
                Consultar salida de {check.command}
              </a>
            ) : (
              <p className="small muted">
                Salida ausente; no acredita aprobación.
              </p>
            )}
          </li>
        ))}
      </ol>
      {report.e2e ? (
        <>
          <h3>E2E del build del Commit candidato</h3>
          <p>
            {report.e2e.executedTests} pruebas ejecutadas ·{" "}
            {report.e2e.skippedTests} omitidas.
          </p>
          <p>
            Servidor propio: {report.e2e.origin} · Build: {report.e2e.serves} ·
            Sin reutilizar servidor.
          </p>
          <p>
            Modo offline: {report.e2e.offline ? "Sí" : "No"}. Alcance local; no
            acredita Vercel.
          </p>
          <ul>
            {report.e2e.browsers.map((browser, index) => (
              <li key={index}>
                {browser.name} · Canal: {browser.channel ?? "Predeterminado"} ·
                Ejecutable:{" "}
                {browser.executablePath ?? "Gestionado por Playwright"}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h3>Evidencia por criterio</h3>
      <p>
        El contrato técnico aporta contexto. Cada criterio requiere revisión
        humana y evidencia específica.
      </p>
      <ol className="criteria">
        {report.criteria.map((criterion, index) => (
          <li key={index}>
            <p className="criterion-text">{criterion.text}</p>
            <strong>
              {criterion.status === "human_pending"
                ? "Juicio humano pendiente"
                : "Falta evidencia"}
            </strong>
            <ul className="small muted">
              {criterion.missing.map((missing) => (
                <li key={missing}>{missing}</li>
              ))}
            </ul>
            {criterion.evidence.length ? (
              <ul>
                {criterion.evidence.map((id) => (
                  <li key={id}>
                    <a href={`#part-${id}`}>
                      Contrato técnico:{" "}
                      {report.checks.find((check) => check.partId === id)
                        ?.command ?? id}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
      {report.controls.length ? (
        <>
          <h3>Cambios en controles (informativos)</h3>
          <ul>
            {report.controls.map((control) => (
              <li key={control}>{control}</li>
            ))}
          </ul>
        </>
      ) : null}
      {report.error ? (
        <p className="notice danger" role="alert">
          {report.error}
        </p>
      ) : null}
      {report.effectsUncertain ? (
        <p className="notice danger">
          Hay procesos o efectos sin aclarar. El puesto permanece reservado;
          comprueba los grupos registrados y el servidor antes de recuperar la
          Ejecución.
        </p>
      ) : null}
      <h3>Limitaciones de la verificación</h3>
      <ul>
        {report.limitations.map((limitation) => (
          <li key={limitation}>{limitation}</li>
        ))}
      </ul>
      <p className="small muted">
        Los cambios en pruebas y configuración del producto se muestran como
        información para la revisión humana y no bloquean las verificaciones.
        Superar las comprobaciones no demuestra la calidad de las pruebas. El
        estado de preview y aceptación se muestra por separado. La revisión
        humana del preview precede al merge y al cierre del issue.
      </p>
    </section>
  );
}
