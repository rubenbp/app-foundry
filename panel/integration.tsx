import type { Run } from "../src/domain/run.ts";
import { Commit } from "./commit.tsx";
import { dateTime } from "./format.ts";
import { publicationState } from "./publication-state.ts";

export function IntegrationDetails({ run }: { run: Run }) {
  const publication = run.publication;
  const state = publicationState(run);
  if (!publication || !state) {
    return null;
  }
  const { acceptance, pull } = publication;

  return (
    <section
      className="card verification integration"
      aria-labelledby="integration-title"
    >
      <h2 id="integration-title">Integración y cierre</h2>
      <dl className="usage">
        <div>
          <dt>Versión de partida</dt>
          <dd>
            <Commit run={run} head={run.workspace?.baseSha} />
          </dd>
        </div>
        <div>
          <dt>Commit candidato aceptado</dt>
          <dd>
            {acceptance ? (
              <>
                <Commit run={run} head={acceptance.head} /> ·{" "}
                {state.acceptanceLabel}
              </>
            ) : (
              "Sin aceptación acreditada"
            )}
          </dd>
        </div>
        <div>
          <dt>Commit integrado</dt>
          <dd>
            <Commit run={run} head={publication.mergeSha} />
          </dd>
        </div>
        <div>
          <dt>Merge observado</dt>
          <dd>
            {pull?.merged ? (
              <>
                {pull.mergedBy ?? "Autor sin acreditar"} ·{" "}
                {pull.mergedAt === undefined ? (
                  "Fecha sin acreditar"
                ) : (
                  <time dateTime={new Date(pull.mergedAt).toISOString()}>
                    {dateTime(pull.mergedAt)}
                  </time>
                )}
              </>
            ) : (
              "Sin merge observado"
            )}
          </dd>
        </div>
        <div>
          <dt>Cierre del issue</dt>
          <dd>
            {publication.closedAt === undefined ? (
              "Cierre del issue pendiente"
            ) : (
              <>
                Issue cerrado ·{" "}
                <time dateTime={new Date(publication.closedAt).toISOString()}>
                  {dateTime(publication.closedAt)}
                </time>
              </>
            )}
          </dd>
        </div>
      </dl>
      <p role="status">
        {publication.mergeSha && publication.closedAt !== undefined
          ? "Integración completada e issue cerrado."
          : run.status === "intervention"
            ? "Integración o cierre pendientes de intervención."
            : publication.mergeSha
              ? "Merge observado. Resumen de integración y cierre se acreditan por separado."
              : "Sin Commit integrado observado."}
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
      ) : (
        <p>Resumen de integración pendiente.</p>
      )}
      <p className="small muted">
        La finalización de la Ejecución no acredita una validación de
        producción.
      </p>
      <details
        onToggle={(event) => {
          if (event.currentTarget.open) {
            document.dispatchEvent(new Event("cabina:inspect"));
          }
        }}
      >
        <summary>Identificadores de integración</summary>
        <dl className="usage">
          <div>
            <dt>Versión de partida completa</dt>
            <dd>{run.workspace?.baseSha ?? "Sin observar"}</dd>
          </div>
          <div>
            <dt>Commit de la aceptación completo</dt>
            <dd>{acceptance?.head ?? "Sin aceptación acreditada"}</dd>
          </div>
          <div>
            <dt>Commit integrado completo</dt>
            <dd>{publication.mergeSha ?? "Sin observar"}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
