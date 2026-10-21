import type { Run } from "../../src/domain/run.ts";
import { CompactVerificationCheck } from "../verification.tsx";

export function RunDetails({ run }: { run: Run }) {
  const request = run.request;
  const repository = request
    ? `https://github.com/${request.repository}`
    : null;
  const baseBranch = request?.configuration.baseBranch;
  const baseSha = run.workspace?.baseSha;
  const pull = run.publication?.pull;

  return (
    <section
      className="card dashboard-code-details"
      aria-labelledby="dashboard-code-title"
    >
      <h2 id="dashboard-code-title">Código de la Ejecución</h2>
      <dl className="dashboard-code-links">
        <div>
          <dt>Repositorio</dt>
          <dd>
            {repository ? (
              <a href={repository} target="_blank" rel="noreferrer">
                {request!.repository} ↗
              </a>
            ) : (
              "Ejecución manual"
            )}
          </dd>
        </div>
        <div>
          <dt>Rama principal</dt>
          <dd>
            {repository && baseBranch ? (
              <a
                href={`${repository}/tree/${encodeURIComponent(baseBranch)}`}
                target="_blank"
                rel="noreferrer"
              >
                {baseBranch} ↗
              </a>
            ) : (
              "Sin registrar"
            )}
          </dd>
        </div>
        <div>
          <dt>Versión de partida</dt>
          <dd>
            {repository && baseSha ? (
              <>
                <a
                  href={`${repository}/tree/${encodeURIComponent(baseSha)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ver código de partida ↗
                </a>
                <small>Capturado desde {baseBranch} al comenzar.</small>
              </>
            ) : (
              "Pendiente de capturar"
            )}
          </dd>
        </div>
        <div>
          <dt>Trabajo de esta Ejecución</dt>
          <dd>
            {pull ? (
              <a href={`${pull.url}/files`} target="_blank" rel="noreferrer">
                Ver cambios del issue #{request?.number} ↗
              </a>
            ) : run.workspace?.branch ? (
              "Rama local de trabajo · todavía sin PR"
            ) : (
              "Pendiente de preparar"
            )}
          </dd>
        </div>
      </dl>
      <details className="dashboard-evidence-disclosure">
        <summary>Identificadores, configuración e instrucciones</summary>
        <dl className="dashboard-code-identifiers">
          <div>
            <dt>Commit de partida</dt>
            <dd>
              {repository && baseSha ? (
                <a
                  href={`${repository}/commit/${encodeURIComponent(baseSha)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {baseSha} ↗
                </a>
              ) : (
                "Pendiente de capturar"
              )}
            </dd>
          </div>
          <div>
            <dt>Rama de la Ejecución</dt>
            <dd>
              {run.workspace?.branch && pull ? (
                <a
                  href={pull.url}
                  title="Abrir la PR asociada a esta rama"
                  target="_blank"
                  rel="noreferrer"
                >
                  {run.workspace.branch} ↗
                </a>
              ) : (
                (run.workspace?.branch ?? "Pendiente de preparar")
              )}
            </dd>
          </div>
          {request ? (
            <div>
              <dt>Issue autorizado</dt>
              <dd>
                <a href={request.url} target="_blank" rel="noreferrer">
                  Issue #{request.number} · {request.author} ↗
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
        {request ? (
          <>
            <h3>Configuración capturada</h3>
            <pre tabIndex={0}>
              {JSON.stringify(
                { project: request.configuration, agent: request.runtime },
                null,
                2,
              )}
            </pre>
          </>
        ) : null}
        {run.workspace?.instructions.map((instruction) => (
          <div key={instruction.path}>
            <h3>{instruction.path}</h3>
            <pre tabIndex={0}>{instruction.text}</pre>
          </div>
        ))}
      </details>
    </section>
  );
}

export function VerificationDetails({ run }: { run: Run }) {
  const report = run.verification;
  if (!report) {
    return null;
  }
  const repository = run.request
    ? `https://github.com/${run.request.repository}`
    : null;
  const passed = report.checks.filter(
    (check) => check.status === "passed",
  ).length;
  const sharedEvidence = report.criteria.length
    ? report.criteria[0].evidence.filter((id) =>
        report.criteria.every((criterion) => criterion.evidence.includes(id)),
      )
    : [];
  const checkLabel = (id: string) =>
    report.checks.find((check) => check.partId === id)?.command ?? id;
  const e2e = report.e2e;
  const status = {
    running: "En curso",
    passed: "Comprobaciones superadas",
    failed: "Comprobaciones fallidas",
    intervention: "Requiere intervención",
  }[report.status];

  return (
    <section
      className="card dashboard-verification"
      aria-labelledby="verification-title"
    >
      <header className="dashboard-evidence-heading">
        <div>
          <h2 id="verification-title">Verificación independiente</h2>
          <p>
            Comprobaciones del Commit candidato y evidencia para revisar el
            resultado.
          </p>
        </div>
        <span className={`dashboard-evidence-status ${report.status}`}>
          {status}
        </span>
      </header>
      <nav
        className="dashboard-evidence-links"
        aria-label="Evidencia del Commit candidato"
      >
        {repository && report.headSha ? (
          <a
            target="_blank"
            rel="noreferrer"
            href={`${repository}/compare/${report.baseSha}...${report.headSha}`}
          >
            Revisar cambios en GitHub ↗
          </a>
        ) : null}
        <a href={`#part-${report.diffPartId}`}>Salida del diff ↗</a>
        <a href={`#part-${report.configurationPartId}`}>
          Configuración y alcance ↗
        </a>
      </nav>
      {report.error ? (
        <p className="dashboard-evidence-alert" role="alert">
          {report.error}
        </p>
      ) : null}
      {report.effectsUncertain ? (
        <p className="dashboard-evidence-alert" role="alert">
          Hay procesos o efectos sin aclarar. La Ejecución conserva su puesto;
          revisa el diagnóstico antes de recuperarla.
        </p>
      ) : null}
      <div className="dashboard-evidence-section-heading">
        <h3>Comprobaciones</h3>
        <span>
          {passed} / {report.checks.length} correctas
        </span>
      </div>
      <ol className="verification-checks is-compact">
        {report.checks.map((check) => (
          <CompactVerificationCheck
            key={check.partId}
            check={check}
            hasOutput={run.parts.some((part) => part.id === check.partId)}
          />
        ))}
      </ol>
      {e2e ? (
        <section
          className="dashboard-browser-evidence"
          aria-labelledby="dashboard-e2e-title"
        >
          <div className="dashboard-evidence-section-heading">
            <h3 id="dashboard-e2e-title">Pruebas de navegador · E2E</h3>
            <span>Verificación local</span>
          </div>
          <dl className="dashboard-browser-metrics">
            <div>
              <dt>Pruebas ejecutadas</dt>
              <dd>{e2e.executedTests}</dd>
            </div>
            <div className={e2e.skippedTests ? "has-skipped" : ""}>
              <dt>Omitidas</dt>
              <dd>{e2e.skippedTests}</dd>
            </div>
            <div>
              <dt>Navegador observado</dt>
              <dd>
                {e2e.browsers.map((browser) => browser.name).join(", ") ||
                  "Sin observar"}
              </dd>
            </div>
          </dl>
          {e2e.offline ? (
            <p className="dashboard-evidence-alert">
              Modo offline · alcance reducido de las pruebas.
            </p>
          ) : null}
          <details className="dashboard-evidence-disclosure">
            <summary>Entorno de las pruebas</summary>
            <dl className="dashboard-code-identifiers">
              <div>
                <dt>Servidor propio</dt>
                <dd>{e2e.origin}</dd>
              </div>
              <div>
                <dt>Build servido</dt>
                <dd>{e2e.serves}</dd>
              </div>
              <div>
                <dt>Reutiliza un servidor</dt>
                <dd>No</dd>
              </div>
              <div>
                <dt>Modo offline</dt>
                <dd>{e2e.offline ? "Sí" : "No"}</dd>
              </div>
            </dl>
            {e2e.browsers.map((browser, index) => (
              <div key={index}>
                <p>
                  {browser.name} · Canal {browser.channel ?? "predeterminado"}
                </p>
                <code>
                  {browser.executablePath ??
                    "Ejecutable gestionado por Playwright"}
                </code>
              </div>
            ))}
          </details>
        </section>
      ) : null}
      <section
        className="dashboard-criteria-section"
        aria-labelledby="dashboard-criteria-title"
      >
        <div className="dashboard-evidence-section-heading">
          <h3 id="dashboard-criteria-title">Criterios de aceptación</h3>
          <span>{report.criteria.length} criterios</span>
        </div>
        <p className="dashboard-criteria-context">
          {run.publication?.acceptance &&
          run.publication.acceptance.head === run.publication.head
            ? `Aceptación registrada mediante merge por ${run.publication.acceptance.author}. Los criterios no tienen validación automática específica.`
            : "La suite aporta evidencia técnica. Los criterios requieren revisión humana."}
        </p>
        <ol className="dashboard-criterion-cards">
          {report.criteria.map((criterion, index) => {
            const specificEvidence = criterion.evidence.filter(
              (id) => !sharedEvidence.includes(id),
            );

            return (
              <li key={index}>
                <span className="dashboard-criterion-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <p>
                    {criterion.text.replace(/^\s*(?:[-*]\s+|\d+\.\s+)/, "")}
                  </p>
                  {specificEvidence.length ? (
                    <div className="dashboard-evidence-chips">
                      {specificEvidence.map((id) => (
                        <a key={id} href={`#part-${id}`}>
                          {checkLabel(id)} ↗
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
                <span
                  className={`dashboard-criterion-status ${criterion.status}`}
                >
                  {criterion.status === "human_pending"
                    ? "Revisión humana"
                    : "Falta evidencia"}
                </span>
              </li>
            );
          })}
        </ol>
        {sharedEvidence.length ? (
          <div className="dashboard-shared-evidence">
            <h4>Evidencia técnica común</h4>
            <p>Estas comprobaciones aportan contexto a todos los criterios.</p>
            <div className="dashboard-evidence-chips">
              {sharedEvidence.map((id) => (
                <a key={id} href={`#part-${id}`}>
                  {checkLabel(id)} ↗
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      {report.controls.length ? (
        <section className="dashboard-control-changes">
          <h3>Cambios en pruebas o configuración</h3>
          <ul>
            {report.controls.map((control) => {
              const separator = control.indexOf(": ");
              const path = separator < 0 ? null : control.slice(0, separator);

              return (
                <li key={control}>
                  {repository && report.headSha && path ? (
                    <a
                      href={`${repository}/blob/${report.headSha}/${path.split("/").map(encodeURIComponent).join("/")}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {path} ↗
                    </a>
                  ) : (
                    control
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <details className="dashboard-evidence-disclosure dashboard-evidence-audit">
        <summary>Registro de evidencia</summary>
        <h4>Identidad de la versión comprobada</h4>
        <dl className="dashboard-code-identifiers">
          <div>
            <dt>Base</dt>
            <dd>{report.baseSha}</dd>
          </div>
          <div>
            <dt>Commit candidato</dt>
            <dd>{report.headSha ?? "Sin fijar"}</dd>
          </div>
        </dl>
        <h4>Evidencia original por criterio y cambios en controles</h4>
        <pre tabIndex={0}>
          {JSON.stringify(
            { criteria: report.criteria, controls: report.controls },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}
