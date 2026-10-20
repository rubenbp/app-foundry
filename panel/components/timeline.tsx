import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Run } from "../../src/domain/run.ts";
import { timelineEntries, type TimelineEntry } from "../timeline.ts";
import { timelineReading } from "../reading.ts";
import { Button } from "./button.tsx";
import { Output } from "./output.tsx";
import { time } from "../format.ts";
import { phaseDetails, currentPhase } from "../phases.tsx";

const presentation = {
  event: { label: "Evento", icon: "○" },
  message: { label: "Mensaje", icon: "✉" },
  tool: { label: "Herramienta", icon: "⚒" },
  evidence: { label: "Evidencia", icon: "▤" },
  error: { label: "Fallo · Atención", icon: "!" },
  technical: { label: "Registro técnico", icon: "⚙" },
};

function Entry({
  entry,
  runId,
  operationOpen,
  onOperationToggle,
}: {
  entry: TimelineEntry;
  runId: string;
  operationOpen: boolean;
  onOperationToggle: (open: boolean) => void;
}) {
  const appearance = presentation[entry.kind];
  const label =
    entry.kind === "error" && entry.part?.kind === "tool"
      ? "Herramienta · Fallo"
      : appearance.label;

  return (
    <li
      className={`timeline-entry entry-${entry.kind}`}
      data-entry-id={entry.id}
      data-entry-version={entry.version}
    >
      <time
        title={
          entry.part
            ? "Última actualización observada; no acredita el inicio de la llamada"
            : "Hora registrada"
        }
      >
        {time(entry.at)}
      </time>
      <div>
        <span className="entry-label">
          <span aria-hidden="true">{appearance.icon}</span> {label}
        </span>
        {entry.part ? (
          <Output runId={runId} part={entry.part} />
        ) : entry.operation ? (
          <>
            <strong className="entry-title">{entry.label}</strong>
            <p className="operation-state">
              {entry.operation.state === "started"
                ? "Intención sin confirmar"
                : entry.operation.state === "confirmed"
                  ? entry.operation.records[0]?.record.kind === "confirmed"
                    ? "Confirmación sin inicio observado"
                    : "Confirmada"
                  : "Observación"}
              {entry.operation.category
                ? ` · ${entry.operation.records.length} ${entry.operation.records.length === 1 ? "registro" : "registros"}`
                : ""}
            </p>
            {entry.kind === "error" ? <p>{entry.text}</p> : null}
            <details
              className="operation-detail"
              open={operationOpen}
              onToggle={(event) => {
                onOperationToggle(event.currentTarget.open);
                if (event.currentTarget.open) {
                  document.dispatchEvent(new CustomEvent("cabina:inspect"));
                }
              }}
            >
              <summary>Detalle de la operación</summary>
              {entry.operation.note ? <p>{entry.operation.note}</p> : null}
              {entry.operation.references.length ? (
                <dl className="operation-references">
                  {entry.operation.references.map((reference) => (
                    <div key={reference.label}>
                      <dt>{reference.label}</dt>
                      <dd>{reference.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <ol
                className="technical-records"
                aria-label="Observaciones retenidas"
              >
                {entry.operation.records.map(({ index, record }) => (
                  <li key={index}>
                    <time>{time(record.at)}</time>{" "}
                    <span>
                      {record.kind}: {record.text}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          </>
        ) : (
          <>
            <strong className="entry-title">{entry.label}</strong>
            <p>{entry.text}</p>
            {entry.result ? (
              <details
                onToggle={(event) => {
                  if (event.currentTarget.open) {
                    document.dispatchEvent(new CustomEvent("cabina:inspect"));
                  }
                }}
              >
                <summary>
                  Consultar resultado del agente · Sin verificar
                </summary>
                <pre tabIndex={0}>{entry.result}</pre>
              </details>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

/** One chronological projection; the unfiltered source remains available for inspection. */
export function Timeline({ run }: { run: Run }) {
  const [technical, setTechnical] = useState(false);
  const [openOperations, setOpenOperations] = useState(new Set<string>());
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const reading = useRef<ReturnType<typeof timelineReading> | null>(null);
  const [readingState, setReadingState] = useState({
    following: true,
    pending: 0,
  });
  const entries = timelineEntries(run);
  const visible = entries.filter(
    (entry) => technical || entry.kind !== "technical",
  );

  useLayoutEffect(() => {
    const session = timelineReading(
      viewport.current!,
      content.current!,
      setReadingState,
    );
    reading.current = session;
    return () => session.close();
  }, []);

  useLayoutEffect(() => {
    reading.current?.observe(entries, visible);
  });

  useEffect(() => {
    const reveal = (partId: string) => {
      const button = document.getElementById(`output-toggle-${partId}`);
      if (!button || !root.current?.contains(button)) {
        return;
      }
      document.dispatchEvent(new CustomEvent("cabina:inspect"));
      if (button.getAttribute("aria-expanded") !== "true") {
        button.click();
      }
      button.focus({ preventScroll: true });
      reading.current?.locate(button);
    };
    const openOutput = (event: Event) => {
      const detail: unknown =
        event instanceof CustomEvent ? event.detail : null;
      if (
        detail &&
        typeof detail === "object" &&
        "runId" in detail &&
        detail.runId === run.id &&
        "partId" in detail &&
        typeof detail.partId === "string"
      ) {
        reveal(detail.partId);
      }
    };
    const openLink = (event: MouseEvent) => {
      const link =
        event.target instanceof Element ? event.target.closest("a") : null;
      const href = link?.getAttribute("href");
      if (!href?.startsWith("#part-") || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      reveal(href.slice(6));
    };
    document.addEventListener("cabina:open-output", openOutput);
    document.addEventListener("click", openLink);
    return () => {
      document.removeEventListener("cabina:open-output", openOutput);
      document.removeEventListener("click", openLink);
    };
  }, [run.id]);

  return (
    <div className="unified-activity" ref={root}>
      <div className="activity-heading">
        <h2>{phaseDetails(currentPhase(run)).label}</h2>
        <span className="small muted">Actividad observada</span>
      </div>
      <div className="section-heading">
        <h3>Cronología</h3>
        <span className="count">
          {visible.length} entradas visibles · {run.history.length} registros de
          origen
        </span>
      </div>
      <div className="timeline-controls">
        <label>
          <input
            type="checkbox"
            checked={technical}
            onChange={(event) => setTechnical(event.target.checked)}
          />{" "}
          Registro técnico
        </label>
        <span className="small muted">
          Salidas: última actualización observada.
        </span>
      </div>
      <div
        ref={viewport}
        className="timeline-viewport"
        role="region"
        aria-label="Entradas de la cronología"
        tabIndex={0}
      >
        <div ref={content} className="timeline-content">
          <ol className="timeline" aria-label="Cronología">
            {visible.map((entry) => (
              <Entry
                key={entry.id}
                entry={entry}
                runId={run.id}
                operationOpen={openOperations.has(entry.id)}
                onOperationToggle={(open) =>
                  setOpenOperations((previous) => {
                    const next = new Set(previous);
                    if (open) {
                      next.add(entry.id);
                    } else {
                      next.delete(entry.id);
                    }
                    return next;
                  })
                }
              />
            ))}
          </ol>
          {!visible.length ? (
            <p className="muted">Sin actividad observada.</p>
          ) : null}
          <details
            className="original-record"
            onToggle={(event) => {
              if (event.currentTarget.open) {
                document.dispatchEvent(new CustomEvent("cabina:inspect"));
              }
            }}
          >
            <summary>Ver registro original</summary>
            <section role="region" aria-label="Registro original">
              <h3>Historial íntegro · {run.history.length} registros</h3>
              <ol className="original-history">
                {run.history.map((entry, index) => (
                  <li key={index}>
                    <time>{time(entry.at)}</time> {entry.kind}: {entry.text}
                  </li>
                ))}
              </ol>
              <h3>Salidas retenidas · {run.parts.length}</h3>
              <ul>
                {run.parts.map((part) => (
                  <li key={part.id}>
                    <a href={`#part-${part.id}`}>{part.label}</a>
                  </li>
                ))}
              </ul>
            </section>
          </details>
        </div>
      </div>
      <footer
        className="timeline-footer"
        aria-label="Seguimiento de la cronología"
      >
        <div role="status" aria-live="polite">
          <strong>
            {readingState.following
              ? "Siguiendo la actividad"
              : "Leyendo el historial"}
          </strong>
          {!readingState.following ? (
            <span>
              {readingState.pending}{" "}
              {readingState.pending === 1 ? "novedad" : "novedades"}
            </span>
          ) : null}
        </div>
        <div>
          <Button variant="ghost" onClick={() => reading.current?.beginning()}>
            Consultar desde el inicio
          </Button>
          <Button variant="outline" onClick={() => reading.current?.resume()}>
            Volver al final
          </Button>
        </div>
      </footer>
    </div>
  );
}
