import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RequestDetails } from "./request.tsx";
import { VerificationDetails } from "./verification.tsx";
import { Button } from "./components/button.tsx";
import { poll } from "./polling.ts";
import {
  consumption,
  type Run,
  type RunStatus,
  type PartView,
} from "../src/types.ts";
import "./style.css";

interface View {
  serverNow: number;
  admission: { at: number; lastSuccess: number | null; error: string | null };
  source: string | null;
  queue: { id: string; title: string }[];
  fault: string | null;
  runs: Pick<Run, "id" | "task" | "status" | "startedAt">[];
  run: Run | null;
  consumption: ReturnType<typeof consumption> | null;
}
const labels: Record<RunStatus, string> = {
  queued: "En cola",
  preparing: "Preparando base",
  starting: "Preparando",
  running: "En curso",
  waiting: "Espera humana",
  awaiting_verification: "Resultado sin verificar",
  verifying: "Verificando candidato",
  awaiting_preview: "Verificado · Preview pendiente",
  intervention: "Requiere intervención",
  stopped: "Detenida",
};
const time = (value: number | null) =>
  value === null
    ? "No disponible"
    : new Date(value).toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
const age = (value: number | null, now: number) =>
  value === null
    ? "Sin observación"
    : `Hace ${Math.max(0, Math.floor((now - value) / 1000))} s`;

function Output({ runId, part }: { runId: string; part: PartView }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    void fetch(
      `/api/runs/${encodeURIComponent(runId)}/outputs/${encodeURIComponent(part.id)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value = await response.text();
        if (!controller.signal.aborted) setText(value);
      })
      .catch(() => setError(true))
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [open, runId, part.id, part.updatedAt]);
  return (
    <li className="output" id={`part-${part.id}`}>
      <Button
        variant="ghost"
        aria-expanded={open}
        aria-controls={`output-${part.id}`}
        onClick={() => {
          if (!open) setError(false);
          setOpen((value) => !value);
        }}
      >
        <span>
          {open ? "−" : "+"} {part.label}
        </span>
        <span className="muted">
          {time(part.updatedAt)}
          {part.truncated ? " · Truncada" : ""}
        </span>
      </Button>
      {open ? (
        <pre id={`output-${part.id}`} tabIndex={0}>
          {error
            ? "Salida no disponible. Puede existir una laguna de observación."
            : (text ?? "Cargando salida…")}
        </pre>
      ) : null}
    </li>
  );
}

function App() {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [lastLocal, setLastLocal] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [failing, setFailing] = useState(false);
  useEffect(
    () =>
      poll<View>(
        () =>
          `/api/view${selected ? `?run=${encodeURIComponent(selected)}` : ""}`,
        (data) => {
          setView(data);
          setLastLocal(Date.now());
          setFailing(false);
        },
        () => setFailing(true),
      ),
    [selected],
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);
  const run = view?.run;
  const disconnected = now - (lastLocal ?? mountedAt) >= 30_000;
  const silent =
    run &&
    ["running", "starting"].includes(run.status) &&
    now - (run.lastActivity ?? run.startedAt) >= 120_000;
  const opencodeDisconnected =
    run &&
    run.phase !== "verification" &&
    !["queued", "preparing", "stopped"].includes(run.status) &&
    now - (run.lastObservation ?? run.startedAt) >= 30_000;
  const duration = run
    ? Math.max(0, Math.floor(((run.endedAt ?? now) - run.startedAt) / 1000))
    : 0;
  const usage = view?.consumption;

  return (
    <div className="app-shell">
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
        <p className="workspace-label">FACTORY LOCAL</p>
        <div className="nav-current">
          Ejecuciones <span>{view?.runs.length ?? 0}</span>
        </div>
        <h2 className="sidebar-heading">Historial</h2>
        <ul className="run-list">
          {view?.runs.map((item) => (
            <li key={item.id}>
              <button
                aria-current={run?.id === item.id ? "true" : undefined}
                onClick={() => {
                  setSelected(item.id);
                  setView((previous) =>
                    previous
                      ? { ...previous, run: null, consumption: null }
                      : null,
                  );
                }}
              >
                <span
                  className={`status-dot ${item.status}`}
                  aria-hidden="true"
                />
                <span>
                  <strong>{item.task.slice(0, 80)}</strong>
                  <small>
                    {labels[item.status]} · {time(item.startedAt)}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <span className="status-dot running" aria-hidden="true" />
          Loopback · Solo consulta
          <p>Las decisiones humanas permanecen en GitHub.</p>
          <a
            href="https://github.com/rubenbp/app-foundry/issues/15"
            target="_blank"
            rel="noreferrer"
          >
            Contrato del incremento ↗
          </a>
        </div>
      </aside>
      <main id="content" tabIndex={-1}>
        <header className="topbar">
          <span>
            Operaciones <span className="muted">/ Ejecuciones</span>
          </span>
          <span className="connection" role="status">
            {disconnected
              ? "Sin conexión local"
              : failing
                ? "Consulta local fallida"
                : lastLocal
                  ? "Panel conectado"
                  : "Conectando…"}
          </span>
        </header>
        <div className="page">
          <div className="page-heading">
            <div>
              <p className="eyebrow">OBSERVACIÓN Y DEPURACIÓN</p>
              <h1>Centro de ejecuciones</h1>
              <p className="muted">
                Trabajo del agente, estado persistido y evidencia disponible.
              </p>
            </div>
            <span className="local-tag">ENTORNO LOCAL</span>
          </div>
          <div role="status" aria-live="polite">
            {disconnected ? (
              <p className="notice danger">
                Sin respuesta local durante 30 segundos. Se conserva la última
                vista; no se ha reenviado trabajo.
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
                Sin actividad del agente durante 2 minutos. Aviso informativo;
                no provoca reintentos.
              </p>
            ) : null}
            {view?.fault ? <p className="notice danger">{view.fault}</p> : null}
          </div>
          {view?.source ? (
            <section className="card" aria-label="Entrada de GitHub">
              <h2>Entrada de GitHub</h2>
              <p>
                Última consulta correcta: {time(view.admission.lastSuccess)} ·{" "}
                {age(view.admission.lastSuccess, now)}
              </p>
              {view.admission.error ? (
                <p className="notice danger" role="alert">
                  {view.admission.error}
                </p>
              ) : null}
              <a href={view.source} target="_blank" rel="noreferrer">
                Revisar autorización en GitHub ↗
              </a>
            </section>
          ) : null}
          {view?.queue.length ? (
            <section className="card" aria-labelledby="queue-title">
              <h2 id="queue-title">Cola de peticiones</h2>
              <ol>
                {view.queue.map((item) => (
                  <li key={item.id}>
                    <button
                      className="queue-choice"
                      onClick={() => setSelected(item.id)}
                    >
                      {item.title}
                    </button>
                  </li>
                ))}
              </ol>
              <p className="small muted">
                Un solo puesto. Las esperas y las intervenciones lo conservan.
              </p>
            </section>
          ) : null}
          {!run ? (
            <section className="card empty">
              <span className="empty-mark" aria-hidden="true">
                ◇
              </span>
              <h2>
                {view?.runs.length
                  ? "Cargando ejecución"
                  : "Todo empieza con una petición"}
              </h2>
              <p>Autoriza un issue del Managed project con factory:ready.</p>
              <p className="muted">
                Aquí aparecerán el Intento, sus mensajes y las solicitudes
                pendientes.
              </p>
            </section>
          ) : (
            <>
              <section className="card run-card" aria-labelledby="run-title">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">
                      EJECUCIÓN {run.id.slice(0, 8)}
                    </span>
                    <h2 id="run-title">{run.request?.title ?? run.task}</h2>
                  </div>
                  <span className={`badge ${run.status}`}>
                    {labels[run.status]}
                  </span>
                </div>
                <dl className="run-facts">
                  <div>
                    <dt>Intento</dt>
                    <dd>
                      {String(run.attempt).padStart(2, "0")} ·{" "}
                      {run.sessionId ? "OpenCode" : "Pendiente de agente"}
                    </dd>
                  </div>
                  <div>
                    <dt>Inicio</dt>
                    <dd>{time(run.startedAt)}</dd>
                  </div>
                  <div>
                    <dt>Duración</dt>
                    <dd>{duration} s</dd>
                  </div>
                  <div>
                    <dt>Estado del agente</dt>
                    <dd>{run.agentStatus ?? "No observado"}</dd>
                  </div>
                </dl>
                <p className="verification-note">
                  {run.verification?.status === "passed"
                    ? "Contrato técnico comprobado. Los criterios requieren revisión humana; preview y aceptación siguen pendientes."
                    : "El resultado requiere verificación independiente. El estado idle y el texto del agente no acreditan éxito."}
                </p>
              </section>
              <RequestDetails run={run} />
              <VerificationDetails run={run} />
              <section
                className="health-grid"
                aria-label="Antigüedad y procedencia de observaciones"
              >
                <article className="card health">
                  <span className="eyebrow">SERVIDOR LOCAL</span>
                  <strong>{age(lastLocal, now)}</strong>
                  <span>Última respuesta HTTP · {time(lastLocal)}</span>
                </article>
                <article className="card health">
                  <span className="eyebrow">OPENCODE</span>
                  <strong>{age(run.lastObservation, now)}</strong>
                  <span>
                    Última consulta correcta · {time(run.lastObservation)}
                  </span>
                </article>
                <article className="card health">
                  <span className="eyebrow">ACTIVIDAD DEL AGENTE</span>
                  <strong>{age(run.lastActivity, now)}</strong>
                  <span>
                    Último cambio observado · {time(run.lastActivity)}
                  </span>
                </article>
              </section>
              {run.error ? (
                <section className="notice danger">
                  <h2>Requiere intervención</h2>
                  <pre>{run.error}</pre>
                  <p>
                    Revisa la causa y el contexto en el issue. Ejemplo:
                    «Ejecución {run.id}: necesito aclarar los criterios». El
                    panel conserva el puesto; consultar no reanuda el trabajo.
                  </p>
                  <a
                    href={
                      run.request?.url ??
                      "https://github.com/rubenbp/app-foundry/issues/15"
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Registrar la intervención en GitHub ↗
                  </a>
                </section>
              ) : null}
              {run.pending.length ? (
                <section className="card pending">
                  <h2>Solicitudes pendientes</h2>
                  <p>
                    El agente espera una decisión humana. Revisa el contexto en
                    GitHub; la CLI permite detener esta Ejecución.
                  </p>
                  <ul>
                    {run.pending.map((p) => (
                      <li key={p.id}>
                        <span className="badge waiting">
                          {p.kind === "permission" ? "Permiso" : "Pregunta"}
                        </span>
                        <pre>{p.text}</pre>
                        <small>ID: {p.id}</small>
                      </li>
                    ))}
                  </ul>
                  <a
                    href={
                      run.request?.url ??
                      "https://github.com/rubenbp/app-foundry/issues/15"
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir el issue en GitHub ↗
                  </a>
                </section>
              ) : null}
              <div className="detail-grid">
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
                <div className="detail-stack">
                  <section className="card">
                    <div className="section-heading">
                      <h2>Mensajes y herramientas</h2>
                      <span className="count">{run.parts.length}</span>
                    </div>
                    <p className="muted small">
                      Salidas saneadas bajo demanda. El contenido se muestra
                      como texto.
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
                  <section className="card">
                    <h2>Consumo y coste</h2>
                    <dl className="usage">
                      <div>
                        <dt>Tokens observados</dt>
                        <dd>
                          {usage?.observedTokens?.toLocaleString("es-ES") ??
                            "No disponible"}
                        </dd>
                      </div>
                      <div>
                        <dt>Estimación SDK · USD</dt>
                        <dd>
                          {usage?.estimatedCost?.toFixed(6) ?? "No disponible"}
                        </dd>
                      </div>
                      <div>
                        <dt>Equivalente API</dt>
                        <dd>No disponible</dd>
                      </div>
                      <div>
                        <dt>Gasto acreditado</dt>
                        <dd>No disponible</dd>
                      </div>
                    </dl>
                    <p className="small muted">
                      {usage?.source}
                      <br />
                      Modalidad: {usage?.modality}
                      <br />
                      Cobertura: {usage?.coverage}
                      <br />
                      Tarifas: {usage?.tariff}
                    </p>
                    <p className="small muted">
                      Los ceros sin base válida no acreditan gratuidad.
                    </p>
                  </section>
                </div>
              </div>
              {run.result !== null ? (
                <section className="card">
                  <h2>Resultado del agente · Sin verificar</h2>
                  <pre tabIndex={0}>{run.result}</pre>
                </section>
              ) : null}
              <details className="card provenance">
                <summary>Configuración, procesos y lagunas</summary>
                <dl className="usage">
                  <div>
                    <dt>Sesión OpenCode</dt>
                    <dd>{run.sessionId ?? "No registrada"}</dd>
                  </div>
                  <div>
                    <dt>Proceso propio</dt>
                    <dd>
                      {run.process
                        ? `PID ${run.process.pid} · ${run.process.exited ? "Ausencia comprobada o salida observada" : "Sin confirmar detención"}`
                        : "No registrado"}
                    </dd>
                  </div>
                </dl>
                <pre tabIndex={0}>
                  {JSON.stringify(run.process?.configuration ?? {}, null, 2)}
                </pre>
                <ul>
                  {run.gaps.map((gap, i) => (
                    <li key={i}>{gap}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
          <footer className="page-footer">
            App Foundry{" "}
            <span>
              Persistencia local · Consulta objetivo cada 2 s · Sin reenvío
              automático
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
const mountedAt = Date.now();
createRoot(document.getElementById("root")!).render(<App />);
