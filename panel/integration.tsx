import type { Run } from "../src/domain/run.ts";

export function IntegrationDetails({ run }: { run: Run }) {
  const publication = run.publication;
  if (!publication?.mergeSha) {
    return null;
  }

  return (
    <section className="card verification" aria-labelledby="integration-title">
      <h2 id="integration-title">Integración y cierre</h2>
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
          ? "Integración completada e issue cerrado."
          : run.status === "intervention"
            ? "Integración o cierre pendientes de intervención."
            : "Merge observado. Publicando el resumen y cerrando el issue."}
      </p>
      {publication.integrationReport ? (
        <p>
          <a
            href={publication.integrationReport.url}
            target="_blank"
            rel="noreferrer"
          >
            Revisar resumen de integración en GitHub
          </a>
        </p>
      ) : null}
    </section>
  );
}
