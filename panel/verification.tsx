import { useId } from "react";
import type { VerificationCheck } from "../src/domain/verification.ts";
import type { Run } from "../src/domain/run.ts";

const checkLabels = {
  not_run: "No ejecutada",
  running: "En ejecución",
  passed: "Aprobada",
  failed: "Fallida",
  uncertain: "Ejecución sin confirmar",
};
const cleanupLabels = {
  not_started: "Sin proceso iniciado.",
  pending: "Finalización del proceso pendiente de confirmar.",
  confirmed:
    "Comando finalizado; sus comprobaciones de cierre no detectaron procesos pendientes.",
  uncertain: "Finalización del proceso incierta; requiere inspección manual.",
};

function CompactCheck({
  check,
  hasOutput,
}: {
  check: VerificationCheck;
  hasOutput: boolean;
}) {
  const duration =
    check.startedAt !== null && check.endedAt !== null
      ? `${Math.max(0, (check.endedAt - check.startedAt) / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} s`
      : null;

  return (
    <li>
      <div className="verification-check-row">
        <strong>{check.command}</strong>
        <span>{checkLabels[check.status]}</span>
        {duration ? <span className="small muted">{duration}</span> : null}
        {hasOutput ? (
          <a
            href={`#part-${check.partId}`}
            aria-label={`Consultar salida de ${check.command}`}
          >
            Salida ↗
          </a>
        ) : (
          <span className="small muted">
            Salida ausente; no acredita aprobación.
          </span>
        )}
      </div>
      {check.cleanup === "pending" || check.cleanup === "uncertain" ? (
        <p className="notice danger">{cleanupLabels[check.cleanup]}</p>
      ) : null}
      <details>
        <summary>Diagnóstico del comando y cierre</summary>
        <p>Código de salida: {check.code ?? "No observado"}</p>
        <p>Grupo del comando: {check.pid ?? "No observado"}</p>
        <p>
          Inicio:{" "}
          {check.startedAt === null
            ? "No observado"
            : new Date(check.startedAt).toLocaleString("es-ES")}
        </p>
        <p>
          Fin:{" "}
          {check.endedAt === null
            ? "Sin confirmar"
            : new Date(check.endedAt).toLocaleString("es-ES")}
        </p>
        {check.cleanup !== "pending" && check.cleanup !== "uncertain" ? (
          <p>{cleanupLabels[check.cleanup ?? "not_started"]}</p>
        ) : null}
        {check.executedCommand && check.executedCommand !== check.command ? (
          <pre>{check.executedCommand}</pre>
        ) : null}
      </details>
    </li>
  );
}

export function VerificationDetails({ run }: { run: Run }) {
  const titleId = useId();
  const report = run.verification;
  if (!report) {
    return null;
  }
  const repository = run.request?.repository;
  const sharedEvidence = [
    ...new Set(report.criteria[0]?.evidence ?? []),
  ].filter((id) =>
    report.criteria.every((criterion) => criterion.evidence.includes(id)),
  );
  const checkCommand = (id: string) =>
    report.checks.find((check) => check.partId === id)?.command ?? id;
  const diffUrl =
    repository && report.headSha
      ? `https://github.com/${repository}/compare/${report.baseSha}...${report.headSha}`
      : null;

  return (
    <section className="card verification" aria-labelledby={titleId}>
      <h2 id={titleId}>Verificación independiente</h2>
      <p>Árbol completo del Commit candidato y diff acumulado desde la base.</p>
      <details>
        <summary>Identidad del Commit candidato verificado</summary>
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
      </details>
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
          <CompactCheck
            key={check.partId}
            check={check}
            hasOutput={run.parts.some((part) => part.id === check.partId)}
          />
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
            Navegador observado:{" "}
            {report.e2e.browsers.map((browser) => browser.name).join(", ") ||
              "No observado"}
          </p>
          {report.e2e.offline ? (
            <p className="notice">
              Modo offline: alcance local; no acredita preview ni producción.
            </p>
          ) : null}
          {report.e2e.skippedTests > 0 ? (
            <p className="notice danger">
              Hay pruebas omitidas; el alcance de la verificación es incompleto.
            </p>
          ) : null}
          <details>
            <summary>Entorno E2E observado</summary>
            <p>
              Servidor propio: {report.e2e.origin} · Build: {report.e2e.serves}{" "}
              · Sin reutilizar servidor.
            </p>
            <p>Modo offline: {report.e2e.offline ? "Sí" : "No"}.</p>
            <ul>
              {report.e2e.browsers.map((browser, index) => (
                <li key={index}>
                  {browser.name} · Canal: {browser.channel ?? "No observado"} ·
                  Ejecutable: {browser.executablePath ?? "No observado"}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <p className="notice">
          E2E: sin informe observado; pruebas ejecutadas, omitidas y navegador
          no disponibles.
        </p>
      )}
      <h3>Evidencia por criterio</h3>
      <p>
        El contrato técnico aporta contexto. Cada criterio requiere revisión
        humana y evidencia específica.
      </p>
      {sharedEvidence.length ? (
        <div className="shared-evidence">
          <h3>Evidencia común a todos los criterios</h3>
          <ul>
            {sharedEvidence.map((id) => (
              <li key={id}>
                <a href={`#part-${id}`}>Contrato técnico: {checkCommand(id)}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.criteria.length === 0 ? (
        <p className="notice">Sin criterios registrados en el informe.</p>
      ) : null}
      <ol className="criteria" aria-label="Criterios de aceptación">
        {report.criteria.map((criterion, index) => (
          <li key={index}>
            <div className="criterion-heading">
              <span
                className="criterion-number"
                aria-label={`Criterio ${index + 1}`}
              >
                {index + 1}
              </span>
              <h4 className="criterion-text">
                {criterion.text.replace(
                  /^\s*(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s*)?/,
                  "",
                )}
              </h4>
            </div>
            <strong>
              {criterion.status === "human_pending"
                ? "Juicio humano pendiente"
                : "Falta evidencia"}
            </strong>
            {criterion.missing.length ? (
              <ul className="small muted">
                {criterion.missing.map((missing) => (
                  <li key={missing}>{missing}</li>
                ))}
              </ul>
            ) : null}
            {!criterion.evidence.length ? (
              <p className="small muted">
                Sin evidencia asociada a este criterio.
              </p>
            ) : null}
            {criterion.evidence.some((id) => !sharedEvidence.includes(id)) ? (
              <ul>
                {criterion.evidence
                  .filter((id) => !sharedEvidence.includes(id))
                  .map((id) => (
                    <li key={id}>
                      <a href={`#part-${id}`}>
                        Evidencia específica: {checkCommand(id)}
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
          <p>Los cambios en controles no bloquean las verificaciones.</p>
          {diffUrl ? (
            <a href={diffUrl} target="_blank" rel="noreferrer">
              Revisar cambios en controles en el diff
            </a>
          ) : (
            <a href={`#part-${report.diffPartId}`}>
              Revisar cambios en controles en el diff
            </a>
          )}
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
      <details>
        <summary>Registro original de criterios y controles</summary>
        <pre>
          {JSON.stringify(
            { criteria: report.criteria, controls: report.controls },
            null,
            2,
          )}
        </pre>
      </details>
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
