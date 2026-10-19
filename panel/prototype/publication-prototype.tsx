// Throwaway publication layout: review actions first, observation records on demand.
import type { Run } from "../../src/domain/run.ts";
import { validPreview } from "../../src/domain/publication.ts";

const previewStates = {
  pending: "Preparando preview",
  success: "Deployment correcto",
  failure: "Deployment fallido",
  error: "Error de deployment",
  inactive: "Deployment inactivo",
};

function dateTime(value: number) {
  return new Date(value).toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PrototypePublicationDetails({ run }: { run: Run }) {
  const publication = run.publication;
  if (!publication) {
    return null;
  }
  const { preview, pull, acceptance } = publication;
  const request = run.request;
  const configuration = request?.configuration.publication;
  const previewMatches = Boolean(
    request &&
    configuration &&
    validPreview(
      preview,
      publication.head,
      request.repository,
      configuration.projectId,
      configuration.previewEnvironment ?? "Preview",
    ),
  );
  const accepted = acceptance?.head === publication.head;
  const repository = request
    ? `https://github.com/${request.repository}`
    : null;
  const versionMismatch = Boolean(
    preview &&
    (preview.head !== publication.head ||
      (preview.servedHead && preview.servedHead !== publication.head)),
  );

  return (
    <section
      className="card proto-publication"
      aria-labelledby="publication-title"
    >
      <header className="proto-evidence-heading">
        <div>
          <h2 id="publication-title">Preview y aceptación</h2>
          <p>Resultado publicado y revisión humana en GitHub.</p>
        </div>
        <span className={`proto-evidence-status ${accepted ? "passed" : ""}`}>
          {accepted ? "Resultado aceptado" : "Sin aceptación vigente"}
        </span>
      </header>

      {publication.observationError ? (
        <p className="proto-evidence-alert" role="alert">
          No se pudo actualizar la publicación: {publication.observationError}.
          Se muestra la última observación disponible.
        </p>
      ) : null}
      {publication.blocked ? (
        <p className="proto-evidence-alert" role="alert">
          {publication.blocked}
        </p>
      ) : null}
      {versionMismatch ? (
        <p className="proto-evidence-alert" role="alert">
          La preview observada no corresponde al Commit candidato vigente.
        </p>
      ) : null}

      <div className="proto-publication-grid">
        <section
          className="proto-publication-panel"
          aria-labelledby="prototype-preview-title"
        >
          <div className="proto-publication-panel-heading">
            <h3 id="prototype-preview-title">Preview</h3>
            <span
              className={`proto-publication-state ${previewMatches ? "ready" : ""}`}
            >
              {previewMatches
                ? "Disponible"
                : preview
                  ? preview.state !== "success"
                    ? previewStates[preview.state]
                    : versionMismatch
                      ? "Otra versión"
                      : preview.access === "protected"
                        ? "Acceso protegido"
                        : "Comprobación pendiente"
                  : "Pendiente"}
            </span>
          </div>
          <p className="proto-publication-description">
            {previewMatches
              ? "Versión vigente y acceso comprobados."
              : !preview
                ? "Esperando la preview del Commit candidato."
                : preview.access === "protected"
                  ? "Falta acceso autorizado para comprobar la preview."
                  : preview.access === "pending"
                    ? "Acceso pendiente de comprobar."
                    : "La preview aún no acredita la versión vigente."}
          </p>
          {preview?.url ? (
            <a
              className="proto-publication-action primary"
              href={preview.url}
              target="_blank"
              rel="noreferrer"
            >
              {previewMatches ? "Abrir preview" : "Abrir deployment observado"}{" "}
              ↗
            </a>
          ) : null}
        </section>

        <section
          className="proto-publication-panel"
          aria-labelledby="prototype-review-title"
        >
          <div className="proto-publication-panel-heading">
            <h3 id="prototype-review-title">
              {pull ? `PR #${pull.number}` : "Revisión en GitHub"}
            </h3>
            <span
              className={`proto-publication-state ${accepted ? "ready" : ""}`}
            >
              {pull
                ? pull.merged
                  ? "Integrada"
                  : pull.open
                    ? "Abierta"
                    : "Cerrada"
                : "Pendiente"}
            </span>
          </div>
          <p className="proto-publication-description">
            {accepted && acceptance ? (
              <>
                Aceptado mediante merge por <strong>{acceptance.author}</strong>
                .
                <time dateTime={new Date(acceptance.at).toISOString()}>
                  {dateTime(acceptance.at)}
                </time>
              </>
            ) : acceptance ? (
              "La aceptación registrada corresponde a una versión anterior."
            ) : pull ? (
              "Sin aceptación registrada. La revisión y el merge se realizan en GitHub."
            ) : (
              "La PR todavía no se ha publicado."
            )}
          </p>
          {pull ? (
            <a
              className="proto-publication-action"
              href={pull.url}
              target="_blank"
              rel="noreferrer"
            >
              {accepted ? "Ver PR integrada" : "Revisar PR"} ↗
            </a>
          ) : null}
        </section>
      </div>

      <div className="proto-publication-version">
        <span>Versión del resultado</span>
        {repository ? (
          <a
            href={`${repository}/commit/${publication.head}`}
            target="_blank"
            rel="noreferrer"
            title={publication.head}
          >
            <code>{publication.head.slice(0, 7)}</code> ↗
          </a>
        ) : (
          <code title={publication.head}>{publication.head.slice(0, 7)}</code>
        )}
        <a href="#verification-title">Ver evidencia técnica ↑</a>
        {publication.report?.head === publication.head ? (
          <a href={publication.report.url} target="_blank" rel="noreferrer">
            Informe en GitHub ↗
          </a>
        ) : null}
      </div>

      <details className="proto-evidence-disclosure proto-evidence-audit">
        <summary>Detalles de publicación e historial</summary>
        <dl className="proto-code-identifiers">
          <div>
            <dt>Commit candidato vigente</dt>
            <dd>{publication.head}</dd>
          </div>
          <div>
            <dt>Última observación de publicación</dt>
            <dd>
              {publication.observedAt
                ? dateTime(publication.observedAt)
                : "Sin observar"}
            </dd>
          </div>
          {preview ? (
            <>
              <div>
                <dt>Deployment</dt>
                <dd>
                  {preview.id} · {preview.environment} ·{" "}
                  {previewStates[preview.state]}
                </dd>
              </div>
              <div>
                <dt>Proyecto y repositorio</dt>
                <dd>
                  {preview.projectId} · {preview.repository}
                </dd>
              </div>
              <div>
                <dt>Commit del deployment</dt>
                <dd>{preview.head}</dd>
              </div>
              <div>
                <dt>Commit servido</dt>
                <dd>{preview.servedHead ?? "Sin acreditar"}</dd>
              </div>
              <div>
                <dt>Acceso</dt>
                <dd>
                  {preview.access === "verified"
                    ? "Autorizado y comprobado"
                    : preview.access === "protected"
                      ? "Protegido; falta acceso autorizado"
                      : "Pendiente de comprobar"}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
        <h3>Deployments, informes y comentarios procesados</h3>
        <pre tabIndex={0}>
          {JSON.stringify(
            {
              deployments: publication.deployments,
              reports: publication.reports,
              consumed: publication.consumed,
              acceptance,
            },
            null,
            2,
          )}
        </pre>
        <h3>Límites de observación</h3>
        <p>Las salidas técnicas corresponden a la última verificación.</p>
        <ul>
          {publication.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
