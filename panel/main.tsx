import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { IssueDetails, CodeDetails } from "./issue.tsx";
import { VerificationDetails } from "./verification.tsx";
import { PhaseNavigation, phases, currentPhase } from "./phases.tsx";
import { ObservationsDetails } from "./observations.tsx";
import { DetailDialog } from "./dialog.tsx";
import { PhaseContext } from "./phase-context.tsx";
import { poll } from "./polling.ts";
import type { FactoryView } from "../src/application/factoryView.ts";
import { Output } from "./components/output.tsx";
import { labels, time, dateTime } from "./format.ts";
import "./style.css";

function App() {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<FactoryView | null>(null);
  const [lastLocal, setLastLocal] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [failing, setFailing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [consulted, setConsulted] = useState<{
    runId: string;
    phase: number;
  } | null>(null);
  const [dialog, setDialog] = useState<
    "brief" | "code" | "context" | "verification" | "observation" | null
  >(null);
  useEffect(
    () =>
      poll<FactoryView>(
        () =>
          `/api/view${selected ? `?run=${encodeURIComponent(selected)}` : ""}`,
        (data) => {
          setView(data);
          setLoading(false);
          setLastLocal(Date.now());
          setFailing(false);
        },
        () => {
          setFailing(true);
          setLoading(false);
        },
      ),
    [selected],
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);
  const run = view?.run;
  const consultedPhase =
    run && consulted?.runId === run.id
      ? consulted.phase
      : run
        ? currentPhase(run)
        : 0;
  const openDialog = (detail: NonNullable<typeof dialog>) => {
    document.dispatchEvent(new Event("cabina:inspect"));
    setDialog(detail);
  };
  const disconnected = now - (lastLocal ?? mountedAt) >= 30_000;
  const silent =
    run &&
    ["running", "starting"].includes(run.status) &&
    now - (run.lastActivity ?? run.startedAt) >= 120_000;
  const opencodeDisconnected =
    run &&
    run.phase !== "verification" &&
    run.phase !== "publication" &&
    !["queued", "preparing", "stopped"].includes(run.status) &&
    now - (run.lastObservation ?? run.startedAt) >= 30_000;
  const duration = run
    ? Math.max(0, Math.floor(((run.endedAt ?? now) - run.startedAt) / 1000))
    : null;
  const model =
    run?.usage.at(-1)?.model ??
    run?.request?.runtime.model ??
    run?.runtime?.model;
  const chooseRun = (id: string) => {
    setSelected(id);
    setLoading(true);
    setDialog(null);
    setConsulted(null);
    setView((previous) =>
      previous ? { ...previous, run: null, consumption: null } : null,
    );
  };

  return (
    <div
      className="app-shell"
      onClick={(event) => {
        const link =
          event.target instanceof Element
            ? event.target.closest<HTMLAnchorElement>("a[href]")
            : null;
        const href = link?.getAttribute("href");
        if (href === "#verification-title") {
          event.preventDefault();
          openDialog("verification");
        }
        if (href?.startsWith("#part-") && dialog) {
          event.preventDefault();
          const partId = href.slice(6);
          setDialog(null);
          requestAnimationFrame(() =>
            document.dispatchEvent(
              new CustomEvent("cabina:open-output", {
                detail: { runId: run?.id, partId },
              }),
            ),
          );
        }
      }}
    >
      <a className="skip-link" href="#content">
        Saltar al contenido
      </a>
      <aside className="sidebar" aria-label="Navegación de ejecuciones">
        <a className="brand" href="/" aria-label="App Foundry, inicio">
          <span className="brand-icon" aria-hidden="true">
            F
          </span>{" "}
          App Foundry
        </a>
        <p className="workspace-label">FACTORY LOCAL · SOLO CONSULTA</p>
        <div
          className="history-scroll"
          tabIndex={0}
          aria-label="Historial de Ejecuciones"
        >
          <h2 className="sidebar-heading">Historial</h2>
          <ul className="run-list">
            {view?.runs.map((item) => (
              <li key={item.id}>
                <button
                  aria-current={run?.id === item.id ? "true" : undefined}
                  onClick={() => chooseRun(item.id)}
                >
                  <span
                    className={`status-dot ${item.status}`}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>{item.task}</strong>
                    <small>
                      {labels[item.status]} · {dateTime(item.startedAt)}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <section className="sidebar-queue" aria-label="Cola de peticiones">
          <h2 className="sidebar-heading">Cola de peticiones</h2>
          {view?.queue.length ? (
            <ol className="queue-list">
              {view.queue.map((item) => (
                <li key={item.id}>
                  <button
                    className="queue-choice"
                    onClick={() => chooseRun(item.id)}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="small">Sin trabajo en cola.</p>
          )}
        </section>
        <div className="sidebar-footer">
          Las decisiones humanas permanecen en GitHub.
        </div>
      </aside>
      <main id="content" tabIndex={-1}>
        <header className="topbar">
          <h1>Centro de ejecuciones</h1>
          <span className="connection" role="status">
            {disconnected
              ? "Sin conexión local"
              : failing
                ? "Error al consultar el estado local"
                : lastLocal
                  ? "Dashboard conectado"
                  : "Conectando…"}
          </span>
        </header>
        <div className="mobile-selection">
          <label htmlFor="run-selection">Seleccionar Ejecución</label>
          <select
            id="run-selection"
            value={run?.id ?? selected ?? ""}
            onChange={(event) => chooseRun(event.target.value)}
          >
            <option value="" disabled>
              Seleccionar Ejecución
            </option>
            {view?.runs.map((item) => (
              <option key={item.id} value={item.id}>
                {labels[item.status]} · {item.task} · {dateTime(item.startedAt)}
              </option>
            ))}
          </select>
        </div>
        <section className="run-header" aria-labelledby="run-title">
          <div className="section-heading">
            <div className="run-identity">
              <p className="eyebrow">
                {run?.request ? (
                  <a href={run.request.url} target="_blank" rel="noreferrer">
                    Issue #{run.request.number} ↗
                  </a>
                ) : run ? (
                  "Ejecución manual · Sin issue de GitHub"
                ) : (
                  "EJECUCIÓN"
                )}
              </p>
              <h2 id="run-title">
                {run
                  ? (run.request?.title ?? run.task)
                  : failing
                    ? "Error de consulta"
                    : loading
                      ? "Cargando ejecución"
                      : view?.queue.length
                        ? "Cola sin Ejecución seleccionada"
                        : selected
                          ? "Ejecución no disponible"
                          : "Sin Ejecuciones"}
              </h2>
            </div>
            {run ? (
              <span className={`badge ${run.status}`}>
                {labels[run.status]}
              </span>
            ) : null}
          </div>
          <dl className="run-facts">
            <div>
              <dt>Proyecto</dt>
              <dd>{run?.request?.repository ?? "No disponible"}</dd>
            </div>
            <div>
              <dt>Intento</dt>
              <dd>
                {run ? String(run.attempt).padStart(2, "0") : "No disponible"}
              </dd>
            </div>
            <div>
              <dt>Duración</dt>
              <dd>{duration === null ? "No disponible" : `${duration} s`}</dd>
            </div>
            <div>
              <dt>Modelo</dt>
              <dd>{model ?? "No observado"}</dd>
            </div>
            <div>
              <dt>Tokens observados</dt>
              <dd>
                {view?.consumption?.observedTokens?.toLocaleString("es-ES") ??
                  "No disponible"}
              </dd>
            </div>
            <div className="brief-access">
              <dt>Encargo retenido</dt>
              <dd>
                <a
                  href="#brief"
                  aria-haspopup="dialog"
                  onClick={(event) => {
                    event.preventDefault();
                    openDialog("brief");
                  }}
                >
                  Encargo y criterios
                </a>
                <button
                  className="observation-access"
                  aria-haspopup="dialog"
                  onClick={() => openDialog("observation")}
                >
                  Observación y procedencia
                </button>
              </dd>
            </div>
          </dl>
        </section>
        <PhaseNavigation
          run={run}
          consulted={consultedPhase}
          onSelect={(phase) => {
            if (run) {
              setConsulted({ runId: run.id, phase });
            }
          }}
          onCurrent={() => setConsulted(null)}
        />
        <div className="alerts" role="status" aria-live="polite">
          {disconnected ? (
            <p className="notice danger">
              Sin respuesta local durante 30 segundos. Última vista no
              actualizada; no se ha reenviado trabajo.
            </p>
          ) : failing ? (
            <p className="notice danger">
              Error al consultar el estado local.{" "}
              {view
                ? "Última vista no actualizada."
                : "No hay una vista disponible todavía."}
            </p>
          ) : null}
          {opencodeDisconnected ? (
            <p className="notice warning">
              Sin observación correcta de OpenCode durante 30 segundos. El
              enlace local no acredita su conexión.
            </p>
          ) : null}
          {silent ? (
            <p className="notice warning">
              Sin actividad del agente durante 2 minutos. Aviso informativo; no
              provoca reintentos.
            </p>
          ) : null}
          {view?.admission.error ? (
            <p className="notice danger">
              Error de consulta de GitHub: {view.admission.error}
            </p>
          ) : null}
          {run?.publication?.observationError ? (
            <p className="notice danger">
              La observación de publicación no está actualizada:{" "}
              {run.publication.observationError}
            </p>
          ) : null}
          {view?.fault ? <p className="notice danger">{view.fault}</p> : null}
          {run?.error ? (
            <section className="notice danger">
              <h2>Requiere intervención</h2>
              <p>{run.error}</p>
              {run.request ? (
                <a href={run.request.url} target="_blank" rel="noreferrer">
                  Registrar la intervención en GitHub ↗
                </a>
              ) : (
                <p>
                  Ejecución manual sin issue de GitHub. Consulta el contexto
                  local y la CLI para detener el trabajo.
                </p>
              )}
            </section>
          ) : null}
          {run?.pending.length ? (
            <section
              className="notice warning pending"
              aria-labelledby="pending-title"
            >
              <h2 id="pending-title">Solicitudes pendientes</h2>
              <ul>
                {run.pending.map((p) => (
                  <li key={p.id}>
                    <strong>
                      {p.kind === "permission" ? "Permiso" : "Pregunta"}:{" "}
                    </strong>
                    {p.text}
                  </li>
                ))}
              </ul>
              {run.request ? (
                <a href={run.request.url} target="_blank" rel="noreferrer">
                  Abrir el issue en GitHub ↗
                </a>
              ) : (
                <p>
                  Ejecución manual sin issue de GitHub. No hay una vía de
                  respuesta desde el Dashboard; consulta la CLI y el contexto
                  local.
                </p>
              )}
            </section>
          ) : null}
        </div>
        <div className="mobile-context">
          <button
            className="button button-outline"
            aria-haspopup="dialog"
            aria-expanded={dialog === "context"}
            onClick={() => openDialog("context")}
          >
            Consultar contexto
          </button>
        </div>
        <div className="cabina-body">
          <section
            className="activity-scroll"
            role="region"
            aria-label="Actividad de la Ejecución"
            tabIndex={0}
            key={run?.id ?? selected ?? "empty"}
          >
            {!run ? (
              <section className="empty">
                <h2>
                  {failing
                    ? "No se pudo consultar la Ejecución"
                    : loading
                      ? "Cargando ejecución"
                      : "Todo empieza con una petición"}
                </h2>
                <p>
                  {failing
                    ? "La consulta local se volverá a intentar automáticamente."
                    : "Autoriza un issue del Managed project con factory:ready."}
                </p>
              </section>
            ) : (
              <>
                <div className="activity-heading">
                  <h2>{phases[currentPhase(run)]}</h2>
                  <span className="small muted">Actividad observada</span>
                </div>
                <section className="card">
                  <div className="section-heading">
                    <h2>Cronología</h2>
                    <span className="count">
                      {run.history.length} registros
                    </span>
                  </div>
                  <ol className="timeline">
                    {run.history.map((entry, i) => (
                      <li key={i}>
                        <time>{time(entry.at)}</time>
                        <div>
                          <span className="eyebrow">{entry.kind}</span>
                          <p>{entry.text}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
                <section className="card">
                  <div className="section-heading">
                    <h2>Mensajes y herramientas</h2>
                    <span className="count">{run.parts.length}</span>
                  </div>
                  <p className="small muted">
                    Salidas saneadas bajo demanda. El contenido se muestra como
                    texto.
                  </p>
                  <ul className="outputs">
                    {run.parts.map((part) => (
                      <Output
                        key={`${run.id}:${part.id}`}
                        runId={run.id}
                        part={part}
                      />
                    ))}
                  </ul>
                  {!run.parts.length ? (
                    <p className="muted">Sin mensajes observados.</p>
                  ) : null}
                </section>
                {run.result !== null ? (
                  <section className="card">
                    <h2>Resultado del agente · Sin verificar</h2>
                    <pre tabIndex={0}>{run.result}</pre>
                  </section>
                ) : null}
              </>
            )}
          </section>
          <aside
            id="run-context"
            className="context-scroll"
            aria-label="Contexto de la fase consultada"
            tabIndex={0}
          >
            {run ? (
              <>
                {dialog !== "context" &&
                !(dialog === "verification" && consultedPhase === 3) ? (
                  <PhaseContext
                    run={run}
                    phase={consultedPhase}
                    onCode={() => openDialog("code")}
                  />
                ) : null}
              </>
            ) : (
              <p className="muted">
                Selecciona una Ejecución para consultar su contexto.
              </p>
            )}
          </aside>
        </div>
        {run && dialog ? (
          <DetailDialog
            key={run.id}
            title={
              dialog === "brief"
                ? "Encargo y criterios"
                : dialog === "code"
                  ? "Código de la Ejecución"
                  : dialog === "verification"
                    ? "Verificación y evidencias"
                    : dialog === "observation"
                      ? "Observación y procedencia"
                      : `Contexto · ${phases[consultedPhase]}`
            }
            onClose={() => setDialog(null)}
          >
            {dialog === "brief" ? (
              <IssueDetails run={run} />
            ) : dialog === "code" ? (
              <CodeDetails run={run} />
            ) : dialog === "verification" ? (
              run.verification ? (
                <VerificationDetails run={run} />
              ) : (
                <p>Sin informe de verificación disponible.</p>
              )
            ) : dialog === "observation" && view ? (
              <ObservationsDetails
                run={run}
                view={view}
                lastLocal={lastLocal}
                now={now}
              />
            ) : (
              <PhaseContext
                run={run}
                phase={consultedPhase}
                onCode={() => openDialog("code")}
              />
            )}
          </DetailDialog>
        ) : null}
      </main>
    </div>
  );
}
const mountedAt = Date.now();
createRoot(document.getElementById("root")!).render(<App />);
