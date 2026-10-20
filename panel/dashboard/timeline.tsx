// Throwaway timeline: unified read-only history, messages and tool evidence.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import type { History, PartView, Run } from "../../src/domain/run.ts";
import { time } from "../format.ts";
import {
  groupTechnicalEntries,
  technicalKinds,
  technicalOperations,
  type TechnicalOperation,
} from "./technical.ts";

export interface TimelineEntry {
  id: string;
  at: number;
  kind: "event" | "message" | "tool" | "evidence" | "error" | "technical";
  label: string;
  text?: string;
  comment?: History["comment"];
  part?: PartView;
  technical?: TechnicalOperation[];
  version?: string;
}

const historyLabels: Record<string, string> = {
  admitted: "Issue autorizado · ejecución en cola",
  result: "El agente ha terminado · resultado pendiente de verificación",
  "merge-observed": "Merge humano observado",
  completed: "Ejecución completada · issue cerrado",
  "agent-stop": "Edición detenida para fijar el Commit candidato",
  verification: "Verificación independiente finalizada",
  "agent-intervention": "El agente necesita una respuesta",
  "issue-comment": "Comentario enviado a GitHub",
};
const evidenceLabels: Record<string, string> = {
  clone: "Clon de trabajo preparado",
  "base-context": "Base e instrucciones capturadas",
  "verification-worktree": "Integridad del árbol del Commit candidato",
  "verification-diff": "Diff acumulado del Commit candidato",
  "verification-configuration":
    "Configuración de la verificación independiente",
  "verification-controls": "Comparación de los controles de verificación",
};

function historyEntry(entry: History, index: number): TimelineEntry {
  const isError = /error|gap|intervention|stop|recovery/.test(entry.kind);
  const kind =
    isError && entry.kind !== "agent-stop"
      ? "error"
      : technicalKinds.has(entry.kind)
        ? "technical"
        : "event";

  return {
    id: `history-${index}`,
    at: entry.at,
    kind,
    label:
      entry.kind === "preview-error"
        ? entry.text.split("\n")[0]
        : (historyLabels[entry.kind] ?? entry.text),
    text:
      !entry.comment &&
      (historyLabels[entry.kind] || entry.kind === "preview-error")
        ? entry.text
        : undefined,
    comment: entry.comment,
  };
}

function CommentLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

const commentComponents = { a: CommentLink };

export function timelineEntries(run: Run): TimelineEntry[] {
  const history = run.history
    .map(historyEntry)
    // A part is already represented by its expandable output below.
    .filter(
      (_, index) =>
        run.history[index].kind !== "part" &&
        !technicalKinds.has(run.history[index].kind),
    );
  const technical: TimelineEntry[] = technicalOperations(run).map(
    (operation) => ({
      id: operation.id,
      at: operation.at,
      kind: "technical",
      label: operation.label,
      technical: [operation],
    }),
  );
  const parts: TimelineEntry[] = run.parts.map((part) => ({
    id: `part-${part.id}`,
    at: part.updatedAt,
    kind: /(?: · (?:error|failed)| · exit [1-9])/.test(part.label)
      ? "error"
      : part.kind === "text"
        ? "message"
        : part.kind === "evidence"
          ? "evidence"
          : "tool",
    label:
      part.kind === "text"
        ? "Mensaje del agente"
        : (evidenceLabels[part.id] ?? part.label),
    part,
  }));

  const grouped = groupTechnicalEntries(
    [...history, ...parts, ...technical].sort((a, b) => a.at - b.at),
  );

  return grouped.flatMap((entry) =>
    entry.technical
      ? entry.technical.map((operation) => ({
          id: operation.id,
          at: operation.at,
          kind: "technical" as const,
          label: operation.label,
          version: `${operation.state}:${operation.records.length}:${operation.records.at(-1)?.at}`,
          technical: [operation],
        }))
      : [entry],
  );
}

function TechnicalGroup({
  entry,
  onInspect,
}: {
  entry: TimelineEntry;
  onInspect: () => void;
}) {
  return (
    <div className="dashboard-technical-group" onClick={onInspect}>
      <ol>
        {entry.technical?.map((operation) => (
          <li key={operation.id}>
            <details className="dashboard-technical-operation">
              <summary>
                <time>{time(operation.at)}</time>
                <span>{operation.label}</span>
                <small className={operation.state}>
                  {operation.state === "confirmed"
                    ? "Confirmada"
                    : operation.state === "started"
                      ? "Sin confirmar"
                      : "Observado"}
                </small>
              </summary>
              <div className="dashboard-technical-detail">
                {operation.note ? <p>{operation.note}</p> : null}
                {operation.references.length ? (
                  <dl>
                    {operation.references.map((reference, index) => (
                      <div key={index}>
                        <dt>{reference.label}</dt>
                        <dd>{reference.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <pre tabIndex={0}>
                  {operation.records
                    .map(
                      (record) =>
                        `${time(record.at)} · ${record.kind}\n${record.text}`,
                    )
                    .join("\n\n")}
                </pre>
              </div>
            </details>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EntryBody({
  entry,
  runId,
  onInspect,
}: {
  entry: TimelineEntry;
  runId: string;
  onInspect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const message = entry.kind === "message";
  const expanded = message || open;
  const part = entry.part;
  const partId = part?.id;
  const updatedAt = part?.updatedAt;

  useEffect(() => {
    if (!expanded || !partId) {
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setFailed(true);
      controller.abort();
    }, 5000);
    void fetch(
      `/api/runs/${encodeURIComponent(runId)}/outputs/` +
        encodeURIComponent(partId),
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Salida no disponible");
        }
        const text = await response.text();
        if (!controller.signal.aborted) {
          setOutput(text);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [expanded, partId, updatedAt, runId]);

  const content = entry.text ?? output;
  if (message) {
    return (
      <div className="dashboard-message">
        <div className="dashboard-entry-heading">
          <strong>Agente</strong>
          <span>MENSAJE</span>
        </div>
        <pre>
          {failed
            ? "No se pudo consultar el mensaje."
            : (content ?? "Consultando mensaje…")}
        </pre>
      </div>
    );
  }
  if (part || entry.text || entry.comment) {
    return (
      <div className={`dashboard-expandable ${open ? "is-open" : ""}`}>
        <button
          className="dashboard-output-toggle"
          aria-expanded={open}
          aria-controls={`body-${entry.id}`}
          onClick={() => {
            onInspect();
            setOpen(!open);
          }}
        >
          <span className="dashboard-chevron" aria-hidden="true">
            {open ? "⌄" : "›"}
          </span>
          <span className="dashboard-output-label">{entry.label}</span>
          {part?.truncated ? <small>Truncada</small> : null}
          <span className={`dashboard-kind-label ${entry.kind}`}>
            {entry.kind === "tool"
              ? "HERRAMIENTA"
              : entry.kind === "evidence"
                ? "EVIDENCIA"
                : "EVENTO"}
          </span>
        </button>
        {open ? (
          entry.comment ? (
            <div id={`body-${entry.id}`} className="dashboard-comment">
              <p>
                <CommentLink href={defaultUrlTransform(entry.comment.url)}>
                  Ver comentario en GitHub ↗
                </CommentLink>
              </p>
              <Markdown skipHtml components={commentComponents}>
                {entry.comment.body}
              </Markdown>
            </div>
          ) : (
            <pre id={`body-${entry.id}`} tabIndex={0}>
              {failed
                ? "Salida no disponible. La observación tiene una laguna."
                : (content ?? "Consultando salida…")}
            </pre>
          )
        ) : null}
      </div>
    );
  }

  return <p className="dashboard-event-text">{entry.label}</p>;
}

export function Timeline({
  runId,
  entries,
  technicalCount,
  showTechnical,
  onToggleTechnical,
  action,
  onOriginalRecords,
}: {
  runId: string;
  entries: TimelineEntry[];
  technicalCount: number;
  showTechnical: boolean;
  onToggleTechnical: () => void;
  action?: ReactNode;
  onOriginalRecords: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLOListElement>(null);
  const followingRef = useRef(true);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const observed = useRef(new Map<string, string>());
  const pending = useRef(new Set<string>());
  const scrollGeometry = useRef({ height: 0, viewportHeight: 0 });
  const [following, setFollowing] = useState(true);
  const [unread, setUnread] = useState(0);
  const [canScroll, setCanScroll] = useState(false);

  function recordAnchor() {
    const element = viewport.current;
    if (!element) {
      return;
    }
    const top = element.getBoundingClientRect().top;
    const first = Array.from(
      element.querySelectorAll<HTMLElement>("[data-entry-id]"),
    ).find((row) => row.getBoundingClientRect().bottom > top);
    anchor.current = first
      ? {
          id: first.dataset.entryId!,
          top: first.getBoundingClientRect().top - top,
        }
      : null;
  }

  function setFollow(value: boolean) {
    followingRef.current = value;
    setFollowing(value);
    if (value) {
      pending.current.clear();
      setUnread(0);
    } else {
      recordAnchor();
    }
  }

  function scrollToEnd() {
    const element = viewport.current;
    setFollow(true);
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }

  function pauseBeforeUserScroll() {
    // The wheel/touch/key default scroll happens after this handler.
    // Capture its anchor in onScroll, never at the old bottom position.
    followingRef.current = false;
    anchor.current = null;
    setFollowing(false);
  }

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) {
      return;
    }
    for (const entry of entries) {
      const fingerprint = `${entry.at}:${entry.label}:${entry.text ?? ""}:${entry.version ?? ""}`;
      if (observed.current.get(entry.id) !== fingerprint) {
        if (!followingRef.current) {
          pending.current.add(entry.id);
        }
        observed.current.set(entry.id, fingerprint);
      }
    }
    if (followingRef.current) {
      element.scrollTop = element.scrollHeight;
    } else if (anchor.current) {
      const saved = anchor.current;
      const row = Array.from(
        element.querySelectorAll<HTMLElement>("[data-entry-id]"),
      ).find((item) => item.dataset.entryId === saved.id);
      if (row) {
        element.scrollTop +=
          row.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          saved.top;
      }
    }
    const frame = requestAnimationFrame(() => {
      setUnread(pending.current.size);
      setCanScroll(element.scrollHeight > element.clientHeight + 24);
    });

    return () => cancelAnimationFrame(frame);
  }, [entries]);

  useEffect(() => {
    const element = viewport.current;
    const list = content.current;
    if (!element || !list) {
      return;
    }
    // Includes streaming messages, lazy output and viewport/layout resizes.
    const resize = new ResizeObserver(() => {
      setCanScroll(element.scrollHeight > element.clientHeight + 24);
      if (followingRef.current) {
        element.scrollTop = element.scrollHeight;
      } else if (anchor.current) {
        const saved = anchor.current;
        const row = Array.from(list.children).find(
          (item) =>
            item instanceof HTMLElement && item.dataset.entryId === saved.id,
        );
        if (row) {
          element.scrollTop +=
            row.getBoundingClientRect().top -
            element.getBoundingClientRect().top -
            saved.top;
        }
      }
    });
    resize.observe(list);
    resize.observe(element);

    return () => resize.disconnect();
  }, []);

  return (
    <section className="dashboard-timeline" aria-label="Actividad cronológica">
      <header className="dashboard-stream-header">
        <div>
          <h2>Actividad</h2>
          <span>{entries.length} entradas</span>
        </div>
        <div className="dashboard-stream-actions">
          <span
            className={
              following ? "dashboard-live-label" : "dashboard-reading-label"
            }
          >
            <i />
            {following ? "Al final" : "Leyendo historial"}
          </span>
          <button
            className={`dashboard-quiet-button ${showTechnical ? "selected" : ""}`}
            aria-pressed={showTechnical}
            onClick={onToggleTechnical}
            title="Mostrar estados internos, procesos e intenciones"
          >
            Registro técnico <span>{technicalCount}</span>
          </button>
          {action}
        </div>
      </header>
      {showTechnical ? (
        <div className="dashboard-technical-toolbar">
          <span>{technicalCount} registros de origen agrupados</span>
          <button className="dashboard-text-button" onClick={onOriginalRecords}>
            Ver registro original ↗
          </button>
        </div>
      ) : null}
      <div
        className="dashboard-stream-scroll"
        ref={viewport}
        tabIndex={0}
        aria-label="Cronología, desplazamiento independiente"
        onWheel={(event) => {
          if (event.deltaY < 0) {
            pauseBeforeUserScroll();
          }
        }}
        onPointerDown={pauseBeforeUserScroll}
        onTouchStart={pauseBeforeUserScroll}
        onKeyDown={(event) => {
          if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
            pauseBeforeUserScroll();
          }
          if (event.key === "End") {
            event.preventDefault();
            scrollToEnd();
          }
        }}
        onScroll={() => {
          const element = viewport.current;
          if (!element) {
            return;
          }
          const bottom =
            element.scrollHeight - element.clientHeight - element.scrollTop <
            24;
          const resized =
            scrollGeometry.current.height !== element.scrollHeight ||
            scrollGeometry.current.viewportHeight !== element.clientHeight;
          scrollGeometry.current = {
            height: element.scrollHeight,
            viewportHeight: element.clientHeight,
          };
          // A content/viewport resize is not a request to read history.
          if (followingRef.current && resized) {
            element.scrollTop = element.scrollHeight;
            return;
          }
          setFollow(bottom);
          if (!bottom) {
            recordAnchor();
          }
        }}
      >
        <ol ref={content} className="dashboard-entries">
          <li className="dashboard-stream-start">
            <span>INICIO DE LA EJECUCIÓN</span>
            <span>Orden cronológico ↓</span>
          </li>
          {entries.map((entry) => (
            <li
              key={entry.id}
              data-entry-id={entry.id}
              className={`dashboard-entry ${entry.kind}`}
            >
              {entry.kind === "technical" ? (
                <TechnicalGroup
                  entry={entry}
                  onInspect={() => setFollow(false)}
                />
              ) : (
                <>
                  <time dateTime={new Date(entry.at).toISOString()}>
                    {time(entry.at)}
                  </time>
                  <span className="dashboard-entry-icon" aria-hidden="true">
                    {entry.kind === "message"
                      ? "A"
                      : entry.kind === "tool"
                        ? "⌘"
                        : entry.kind === "evidence"
                          ? "✓"
                          : entry.kind === "error"
                            ? "!"
                            : "·"}
                  </span>
                  <EntryBody
                    entry={entry}
                    runId={runId}
                    onInspect={() => setFollow(false)}
                  />
                </>
              )}
            </li>
          ))}
          {!entries.length ? (
            <li className="dashboard-empty-stream">
              Esperando la primera actividad.
            </li>
          ) : null}
        </ol>
      </div>
      <footer className="dashboard-stream-footer">
        <span role="status" aria-live="polite">
          {following
            ? "Estás al día"
            : unread
              ? `${unread} entradas nuevas o actualizadas`
              : "Lectura en pausa"}
        </span>
        {!following ? (
          <button className="dashboard-return-live" onClick={scrollToEnd}>
            ↓{" "}
            {unread
              ? `${unread} ${unread === 1 ? "novedad" : "novedades"} · `
              : ""}
            Volver al final
          </button>
        ) : canScroll ? (
          <button
            className="dashboard-quiet-button"
            onClick={() => {
              setFollow(false);
              if (viewport.current) {
                viewport.current.scrollTop = 0;
              }
            }}
          >
            Consultar desde el inicio ↑
          </button>
        ) : (
          <span>Las novedades aparecerán aquí</span>
        )}
      </footer>
    </section>
  );
}
