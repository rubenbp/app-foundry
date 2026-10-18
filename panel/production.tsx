import type { Run } from "../src/domain/run.ts";

export function ProductionDetails({ run }: { run: Run }) {
  const publication = run.publication;
  if (!publication?.mergeSha) {
    return null;
  }
  const production = publication.production;

  return (
    <section className="card verification" aria-labelledby="production-title">
      <h2 id="production-title">Integración y producción</h2>
      <dl className="usage">
        <div>
          <dt>Base verificada</dt>
          <dd>{run.workspace?.baseSha}</dd>
        </div>
        <div>
          <dt>Candidato aceptado</dt>
          <dd>
            {publication.integratedAcceptance?.head ??
              "Sin aceptación acreditada"}
          </dd>
        </div>
        <div>
          <dt>Commit integrado</dt>
          <dd>{publication.mergeSha}</dd>
        </div>
        <div>
          <dt>Merge observado</dt>
          <dd>
            {publication.pull?.mergedBy ?? "Autor sin acreditar"}
            {publication.pull?.mergedAt
              ? ` · ${new Date(publication.pull.mergedAt).toLocaleString("es-ES")}`
              : ""}
          </dd>
        </div>
      </dl>
      <p role="status">
        {run.status === "completed"
          ? "Producción comprobada. Ejecución completada y petición cerrada."
          : production?.status === "intervention" || publication.blocked
            ? "Producción sin acreditar. Requiere intervención."
            : "Producción pendiente. El merge observado no acredita publicación."}
      </p>
      <p>SHA servido: {production?.servedHead ?? "Sin acreditar"}</p>
      <p>
        <a
          href={run.request!.configuration.publication.productionOrigin}
          target="_blank"
          rel="noreferrer"
        >
          Abrir dominio público
        </a>
      </p>
      {production?.deployment ? (
        <>
          <h3>Deployment de producción</h3>
          <p>
            {production.deployment.id} · {production.deployment.environment} ·{" "}
            {production.deployment.state}
          </p>
          <p>
            Proyecto: {production.deployment.projectId} · Repositorio:{" "}
            {production.deployment.repository}
          </p>
          <p>SHA del deployment: {production.deployment.head}</p>
          {production.deployment.url ? (
            <p>
              <a
                href={production.deployment.url}
                target="_blank"
                rel="noreferrer"
              >
                Abrir deployment de producción
              </a>
            </p>
          ) : null}
        </>
      ) : (
        <p>
          Esperando un deployment del commit integrado, entorno y proyecto
          configurados.
        </p>
      )}
      {production?.evidencePartId ? (
        <p>
          <a href={`#part-${production.evidencePartId}`}>
            Consultar evidencia pública por criterio
          </a>
        </p>
      ) : null}
      {production?.report ? (
        <p>
          <a href={production.report.url} target="_blank" rel="noreferrer">
            Revisar evidencia de producción en GitHub
          </a>
        </p>
      ) : null}
      {production?.error ? (
        <p className="notice danger" role="alert">
          {production.error} El estado y la evidencia se conservan. Revisa los
          hechos y solicita intervención en GitHub.
        </p>
      ) : null}
      <details>
        <summary>Observaciones de producción</summary>
        <ul>
          {production?.observations.map((entry, index) => (
            <li key={index}>
              {new Date(entry.at).toLocaleTimeString("es-ES")} ·{" "}
              {entry.deployment
                ? `${entry.deployment.id} · ${entry.deployment.head} · ${entry.deployment.state}`
                : "Consulta correcta; deployment todavía sin observar"}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
