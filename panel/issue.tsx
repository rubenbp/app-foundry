import type { Run } from "../src/domain/run.ts";

export function IssueDetails({ run }: { run: Run }) {
  const request = run.request;

  return (
    <section
      id="brief"
      className="card"
      aria-label="Encargo autorizado retenido"
    >
      {request ? (
        <>
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
            Se conserva el encargo inicial autorizado. Editar el issue no
            actualiza el encargo ni bloquea la Ejecución. Retirar factory:ready
            no cancela. La consulta no altera la autorización.
          </p>
        </>
      ) : (
        <>
          <p>Ejecución manual · Sin Issue autorizado retenido.</p>
          <pre tabIndex={0}>{run.task}</pre>
        </>
      )}
    </section>
  );
}

export function CodeDetails({ run }: { run: Run }) {
  const request = run.request;
  if (!request) {
    return (
      <p>
        Ejecución manual. Sin repositorio ni versión de partida capturados en un
        Issue autorizado.
      </p>
    );
  }
  const repository = `https://github.com/${request.repository}`;

  return (
    <section className="card" aria-label="Código retenido de la Ejecución">
      <dl className="usage code-context">
        <div>
          <dt>Repositorio</dt>
          <dd>
            <a href={repository} target="_blank" rel="noreferrer">
              {request.repository} ↗
            </a>
          </dd>
        </div>
        <div>
          <dt>Rama principal</dt>
          <dd>
            <a
              href={`${repository}/tree/${encodeURIComponent(request.configuration.baseBranch)}`}
              target="_blank"
              rel="noreferrer"
            >
              {request.configuration.baseBranch} ↗
            </a>
          </dd>
        </div>
        <div>
          <dt>Versión de partida</dt>
          <dd>
            {run.workspace?.baseSha ? (
              <a
                href={`${repository}/tree/${run.workspace.baseSha}`}
                target="_blank"
                rel="noreferrer"
              >
                {run.workspace.baseSha.slice(0, 7)} ↗
              </a>
            ) : (
              "Pendiente de capturar"
            )}
          </dd>
        </div>
        <div>
          <dt>Trabajo de esta Ejecución</dt>
          <dd>
            {run.publication?.pull ? (
              <a
                href={`${run.publication.pull.url}/files`}
                target="_blank"
                rel="noreferrer"
              >
                Diff de la PR #{run.publication.pull.number} ↗
              </a>
            ) : run.workspace ? (
              "Trabajo local en la Factory. Sin PR publicada todavía."
            ) : (
              "Pendiente de preparar el trabajo local."
            )}
          </dd>
        </div>
      </dl>
      <details>
        <summary>
          Identificadores completos, configuración e instrucciones capturadas
        </summary>
        <dl className="usage">
          <div>
            <dt>Versión de partida</dt>
            <dd>{run.workspace?.baseSha ?? "No capturada"}</dd>
          </div>
          <div>
            <dt>Rama local de la Ejecución</dt>
            <dd>{run.workspace?.branch ?? "No preparada"}</dd>
          </div>
          <div>
            <dt>Directorio local</dt>
            <dd>{run.workspace?.directory ?? "No preparado"}</dd>
          </div>
        </dl>
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
    </section>
  );
}
