import type { Run } from "../src/domain/run.ts";

export function IssueDetails({ run }: { run: Run }) {
  if (!run.request) {
    return null;
  }
  const request = run.request;

  return (
    <>
      <details className="card">
        <summary>Código de la Ejecución</summary>
        <dl className="usage">
          <div>
            <dt>Repositorio</dt>
            <dd>{request.repository}</dd>
          </div>
          <div>
            <dt>Rama base</dt>
            <dd>{request.configuration.baseBranch}</dd>
          </div>
          <div>
            <dt>Base comprobada</dt>
            <dd>{run.workspace?.baseSha ?? "Pendiente de capturar"}</dd>
          </div>
          <div>
            <dt>Rama de la Ejecución</dt>
            <dd>{run.workspace?.branch ?? "Pendiente de preparar"}</dd>
          </div>
        </dl>
      </details>
      <details className="card">
        <summary>Encargo y criterios</summary>
        <p>
          <a href={request.url} target="_blank" rel="noreferrer">
            Issue #{request.number}: {request.title} ↗
          </a>
        </p>
        <dl className="usage">
          <div>
            <dt>Autor</dt>
            <dd>{request.author}</dd>
          </div>
        </dl>
        <pre tabIndex={0}>{request.body}</pre>
        <p className="small muted">
          Se conserva el encargo inicial. Editar el issue no actualiza el
          encargo ni bloquea la Ejecución. Retirar factory:ready no cancela. Las
          respuestas en GitHub todavía no se envían al agente. Los secretos se
          omiten; el contenido no se trunca.
        </p>
        <details>
          <summary>Configuración e instrucciones capturadas</summary>
          <pre tabIndex={0}>
            {JSON.stringify(
              { project: request.configuration, agent: request.runtime },
              null,
              2,
            )}
          </pre>
          {run.workspace?.instructions.map((instruction) => (
            <div key={instruction.path}>
              <h3>{instruction.path}</h3>
              <pre tabIndex={0}>{instruction.text}</pre>
            </div>
          ))}
        </details>
      </details>
    </>
  );
}
