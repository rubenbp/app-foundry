import type { Run } from "../src/domain/run.ts";

const deploymentLabels = {
  pending: "Pendiente",
  success: "Correcto",
  failure: "Fallido",
  error: "Error de deployment",
  inactive: "Inactivo; no acredita un fallo de build",
};

export function PublicationDetails({ run }: { run: Run }) {
  const publication = run.publication;
  if (!publication) {
    return null;
  }
  const preview = publication.preview;

  return (
    <section className="card verification" aria-labelledby="publication-title">
      <h2 id="publication-title">Preview y aceptación</h2>
      <dl className="usage">
        <div>
          <dt>SHA del Commit candidato vigente</dt>
          <dd>{publication.head}</dd>
        </div>
        <div>
          <dt>PR</dt>
          <dd>
            {publication.pull ? (
              <a href={publication.pull.url} target="_blank" rel="noreferrer">
                Revisar PR #{publication.pull.number} en GitHub
              </a>
            ) : (
              "Pendiente de publicación"
            )}
          </dd>
        </div>
        <div>
          <dt>Última observación de publicación</dt>
          <dd>
            {publication.observedAt
              ? new Date(publication.observedAt).toLocaleTimeString("es-ES")
              : "Sin observar"}
          </dd>
        </div>
      </dl>
      {preview ? (
        <>
          <h3>Deployment de preview</h3>
          <p>
            {preview.id} · {preview.environment} ·{" "}
            {deploymentLabels[preview.state]}
          </p>
          <p>
            Proyecto: {preview.projectId} · Repositorio: {preview.repository}
          </p>
          <p>SHA del deployment: {preview.head}</p>
          <p>SHA servido: {preview.servedHead ?? "Sin acreditar"}</p>
          <p>
            Acceso:{" "}
            {preview.access === "verified"
              ? "Autorizado y comprobado"
              : preview.access === "protected"
                ? "Protegido; falta acceso autorizado"
                : "Pendiente de comprobar"}
          </p>
          {preview.url ? (
            <a href={preview.url} target="_blank" rel="noreferrer">
              Abrir preview en Vercel
            </a>
          ) : null}
        </>
      ) : (
        <p>Esperando el deployment Preview del SHA del Commit candidato.</p>
      )}
      <h3>Informe y evidencia</h3>
      {publication.report ? (
        <p>
          <a href={publication.report.url} target="_blank" rel="noreferrer">
            Revisar informe y evidencia completa en GitHub
          </a>
        </p>
      ) : (
        <p>
          El informe requiere petición intacta, contrato técnico válido y
          preview de la versión verificada.
        </p>
      )}
      <h3>Aceptación del resultado</h3>
      {(publication.acceptance ?? publication.integratedAcceptance) ? (
        <>
          <p>
            {publication.integratedAcceptance
              ? "Aceptación integrada de "
              : "Aceptación vigente de "}
            {
              (publication.acceptance ?? publication.integratedAcceptance)!
                .author
            }
            .
          </p>
          <p>
            SHA aceptado:{" "}
            {(publication.acceptance ?? publication.integratedAcceptance)!.head}
          </p>
          <p>
            Preview aceptada:{" "}
            {
              (publication.acceptance ?? publication.integratedAcceptance)!
                .preview
            }
          </p>
        </>
      ) : (
        <p>
          Sin aceptación vigente. La persona debe revisar los criterios y
          confirmar SHA y preview en un comentario nuevo.
        </p>
      )}
      {run.status === "awaiting_merge" ? (
        <p className="notice" role="status">
          Esperando merge humano en GitHub. La Factory ha emitido Factory /
          ready-to-merge favorable.
        </p>
      ) : null}
      {publication.report &&
      !publication.acceptance &&
      !publication.mergeSha ? (
        <p>
          Acción pendiente: revisa el informe y responde en GitHub con el
          ejemplo de aceptación mostrado allí.
        </p>
      ) : null}
      {publication.observationError ? (
        <p className="notice danger" role="alert">
          Error de observación/publicación: {publication.observationError}. El
          último deployment observado conserva su estado.
        </p>
      ) : null}
      {publication.blocked ? (
        <p className="notice danger">{publication.blocked}</p>
      ) : null}
      <details>
        <summary>Comentarios procesados y límites</summary>
        <h3>Deployments observados</h3>
        <ul>
          {publication.deployments.map((entry, index) => (
            <li key={index}>
              {new Date(entry.at).toLocaleTimeString("es-ES")} ·{" "}
              {entry.preview.id} · {entry.preview.head} ·{" "}
              {entry.preview.environment} ·{" "}
              {deploymentLabels[entry.preview.state]}
            </li>
          ))}
        </ul>
        <h3>Informes publicados</h3>
        <ul>
          {publication.reports.map((report) => (
            <li key={report.id}>
              <a href={report.url} target="_blank" rel="noreferrer">
                Informe del SHA {report.head}
              </a>
            </li>
          ))}
        </ul>
        <ul>
          {publication.consumed.map((comment) => (
            <li key={comment.id}>
              {comment.id}: {comment.reason}
            </li>
          ))}
        </ul>
        <ul>
          {publication.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
