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
      <h3>Evidencia técnica</h3>
      <p>
        <a href="#verification-title">
          Consultar verificación y salidas completas
        </a>
        . El diff, los resultados y las limitaciones de la versión vigente están
        disponibles en este Dashboard. La descripción funcional está en la PR.
      </p>
      <h3>Aceptación del resultado</h3>
      {publication.acceptance ? (
        <p>Aceptado mediante merge por {publication.acceptance.author}.</p>
      ) : (
        <p>
          Sin aceptación registrada. Para aceptar los cambios, revisa la preview
          y haz merge de la PR en GitHub.
        </p>
      )}
      {run.status === "awaiting_review" ? (
        <p className="notice" role="status">
          Esperando revisión y merge humano en GitHub. Factory / ready-to-merge
          acredita las verificaciones y la preview.
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
        <h3>Versiones presentadas a revisión</h3>
        <ul>
          {publication.reports.map((report) => (
            <li key={report.id}>
              {new Date(report.at).toLocaleTimeString("es-ES")} · {report.head}
            </li>
          ))}
        </ul>
        <p>Las salidas técnicas corresponden a la última verificación.</p>
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
