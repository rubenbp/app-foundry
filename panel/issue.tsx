import type { Run } from "../src/domain/run.ts";

export function IssueDetails({ run }: { run: Run }) {
  if (!run.request) {
    return null;
  }
  const request = run.request;
  const current =
    run.status === "completed"
      ? "Completada"
      : run.publication?.mergeSha
        ? "Integración y cierre"
        : run.status === "queued"
          ? "Cola"
          : run.phase === "preparation"
            ? "Preparación de la base"
            : run.phase === "verification"
              ? "Verificación"
              : run.phase === "publication"
                ? "Preview y aceptación"
                : "Implementación";

  return (
    <>
      <section className="card" aria-label="Fases de la Ejecución">
        <h2>Fases</h2>
        <ol className="phases">
          {[
            "Cola",
            "Preparación de la base",
            "Implementación",
            "Verificación",
            "Preview y aceptación",
            "Integración y cierre",
            "Completada",
          ].map((phase) => (
            <li
              key={phase}
              aria-current={phase === current ? "step" : undefined}
            >
              {phase}
            </li>
          ))}
        </ol>
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
          <div>
            <dt>Fase conservada</dt>
            <dd>{current}</dd>
          </div>
        </dl>
      </section>
      <details className="card">
        <summary>Issue autorizado</summary>
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
