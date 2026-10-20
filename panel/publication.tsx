import type { Run } from "../src/domain/run.ts";
import { Commit } from "./commit.tsx";
import { dateTime } from "./format.ts";
import { deploymentLabels, publicationState } from "./publication-state.ts";

/** The same current facts remain visible while another phase is consulted. */
export function PublicationSummary({ run }: { run: Run }) {
  const state = publicationState(run);
  if (!state) {
    return null;
  }
  return (
    <section className="publication-summary" aria-label="Publicación actual">
      <span>Preview: {state.previewLabel}</span>
      <span>{state.acceptanceLabel}</span>
      {run.publication?.observationError ? (
        <span>Última observación · Sin actualizar</span>
      ) : null}
    </section>
  );
}

export function PublicationAlerts({ run }: { run: Run }) {
  const state = publicationState(run);
  const publication = run.publication;
  if (!state || !publication) {
    return null;
  }
  return (
    <>
      {publication.observationError ? (
        <p className="notice danger" role="alert">
          Error de observación/publicación: {publication.observationError}. Se
          muestra la última observación disponible; el último deployment
          observado conserva su estado.
        </p>
      ) : null}
      {publication.blocked ? (
        <p className="notice danger" role="alert">
          {publication.blocked}
        </p>
      ) : null}
      {state.versionMismatch || state.identityMismatch ? (
        <p className="notice warning" role="alert">
          {state.previewContext}
        </p>
      ) : null}
    </>
  );
}

export function PublicationDetails({ run }: { run: Run }) {
  const publication = run.publication;
  const state = publicationState(run);
  if (!publication || !state) {
    return null;
  }
  const { preview, pull, acceptance } = publication;

  return (
    <section
      className="card verification publication"
      aria-labelledby="publication-title"
    >
      <h2 id="publication-title">Preview y aceptación</h2>
      <p className="small muted">
        Resultado publicado y revisión humana en GitHub.
      </p>
      <PublicationAlerts run={run} />
      <div className="publication-grid">
        <section className="publication-block" aria-label="Preview observada">
          <h3>Preview</h3>
          <strong>{state.previewLabel}</strong>
          <p>{state.previewContext}</p>
          {state.url ? (
            <a href={state.url} target="_blank" rel="noreferrer">
              {state.available
                ? "Abrir preview ↗"
                : "Abrir deployment observado ↗"}
            </a>
          ) : null}
        </section>
        <section className="publication-block" aria-label="PR y aceptación">
          <h3>{pull ? `PR #${pull.number}` : "PR"}</h3>
          <strong>
            {pull
              ? pull.merged
                ? "Integrada"
                : pull.open
                  ? "Abierta"
                  : "Cerrada"
              : "Pendiente de publicación"}
          </strong>
          <p>{state.acceptanceLabel}.</p>
          {acceptance ? (
            <p>
              {state.accepted
                ? "Aceptado mediante merge"
                : "Aceptación de una versión anterior"}{" "}
              por <strong>{acceptance.author}</strong> ·{" "}
              <time dateTime={new Date(acceptance.at).toISOString()}>
                {dateTime(acceptance.at)}
              </time>
              .
            </p>
          ) : (
            <p>La revisión y el merge se realizan en GitHub.</p>
          )}
          {pull ? (
            <a href={pull.url} target="_blank" rel="noreferrer">
              Revisar PR #{pull.number} en GitHub ↗
            </a>
          ) : null}
        </section>
      </div>
      <div className="publication-version">
        <span>Commit candidato</span>
        <Commit run={run} head={publication.head} />
        <a href="#verification-title">
          Consultar verificación y salidas completas
        </a>
        {publication.report?.head === publication.head ? (
          <a href={publication.report.url} target="_blank" rel="noreferrer">
            Informe en GitHub ↗
          </a>
        ) : null}
      </div>
      {run.status === "awaiting_review" ? (
        <p className="small" role="status">
          Esperando revisión y merge humano en GitHub. Las comprobaciones
          técnicas y la preview no sustituyen la aceptación.
        </p>
      ) : null}
      <details
        onToggle={(event) => {
          if (event.currentTarget.open) {
            document.dispatchEvent(new Event("cabina:inspect"));
          }
        }}
      >
        <summary>Detalles de publicación e historial</summary>
        <dl className="usage">
          <div>
            <dt>Commit candidato vigente</dt>
            <dd>{publication.head}</dd>
          </div>
          <div>
            <dt>Última observación de publicación</dt>
            <dd>
              {publication.observedAt === null
                ? "Sin observar"
                : dateTime(publication.observedAt)}
              {publication.observationError ? " · Sin actualizar" : ""}
            </dd>
          </div>
          {preview ? (
            <>
              <div>
                <dt>Deployment</dt>
                <dd>
                  {preview.id} · {preview.environment} ·{" "}
                  {deploymentLabels[preview.state]}
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
                <dt>URL observada</dt>
                <dd>{state.url ?? "Sin URL HTTPS admitida"}</dd>
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
          {acceptance ? (
            <div>
              <dt>Commit de la aceptación</dt>
              <dd>{acceptance.head}</dd>
            </div>
          ) : null}
        </dl>
        <h3>Deployments observados</h3>
        <ul>
          {publication.deployments.map((entry, index) => (
            <li key={index}>
              {dateTime(entry.at)} · {entry.preview.id} · {entry.preview.head} ·{" "}
              {entry.preview.environment} ·{" "}
              {deploymentLabels[entry.preview.state]}
            </li>
          ))}
        </ul>
        <h3>Versiones presentadas a revisión</h3>
        <ul>
          {publication.reports.map((report) => (
            <li key={report.id}>
              <a href={report.url} target="_blank" rel="noreferrer">
                Informe de {report.head} ↗
              </a>{" "}
              · {dateTime(report.at)} · ID {report.id}
            </li>
          ))}
        </ul>
        <h3>Comentarios procesados y límites</h3>
        <ul>
          {publication.consumed.map((comment) => (
            <li key={comment.id}>
              {comment.id}: {comment.reason}
            </li>
          ))}
        </ul>
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
