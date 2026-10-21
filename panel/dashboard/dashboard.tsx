import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FactoryView } from "../../src/application/factoryView.ts";
import type { Run } from "../../src/domain/run.ts";
import { isFinished } from "../../src/domain/run.ts";
import { DeleteRun } from "./deleteRun.tsx";
import { validPreview } from "../../src/domain/publication.ts";
import { PublicationDetails } from "./publication.tsx";
import { IntegrationDetails } from "../integration.tsx";
import { Output } from "../components/output.tsx";
import { labels, time, age } from "../format.ts";
import { Timeline, timelineEntries } from "./timeline.tsx";
import { RunDetails, VerificationDetails } from "./evidence.tsx";

function startDate(value: number) {
  return new Date(value).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const usd = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "code",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});
const summaryUsd = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "code",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatUsd(value: number) {
  return value > 0 && value < 0.000001 ? "<0,000001 USD" : usd.format(value);
}

function formatSummaryUsd(value: number) {
  return value > 0 && value < 0.01 ? "<0,01 USD" : summaryUsd.format(value);
}

function ConsumptionDetails({
  consumption,
}: {
  consumption: NonNullable<FactoryView["consumption"]>;
}) {
  const { tokens, prices, costs, estimatedCost, coverage } = consumption;
  const rows = [
    {
      label: "Entrada",
      tokens: tokens?.input,
      price: prices?.inputUsdPerMillion,
      cost: costs?.input,
    },
    {
      label: "Salida",
      tokens: tokens?.output,
      price: prices?.outputUsdPerMillion,
      cost: costs?.output,
    },
    {
      label: "Lectura de caché",
      tokens: tokens?.cacheRead,
      price: prices?.cacheReadUsdPerMillion,
      cost: costs?.cacheRead,
    },
  ];

  return (
    <section className="dashboard-consumption" aria-label="Consumo de tokens">
      <div className="dashboard-consumption-total">
        <strong>
          {estimatedCost === null
            ? prices
              ? "Coste no disponible: sin datos de tokens"
              : "Coste no disponible: sin tarifas guardadas"
            : `Coste estimado${coverage === "partial" ? " (parcial)" : ""}: ${formatUsd(estimatedCost)}`}
        </strong>
        {prices ? <span>Tarifas guardadas al iniciar</span> : null}
      </div>
      <table aria-label="Detalle de tokens usados">
        <thead>
          <tr>
            <th scope="col">Tipo</th>
            <th scope="col">Tokens</th>
            <th scope="col">USD / millón</th>
            <th scope="col">Coste (USD)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.tokens?.toLocaleString("es-ES") ?? "—"}</td>
              <td>
                {row.price?.toLocaleString("es-ES", {
                  maximumFractionDigits: 6,
                }) ?? "—"}
              </td>
              <td>{row.cost === undefined ? "—" : formatUsd(row.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Entrada incluye escritura de caché; salida incluye razonamiento.
        {coverage === "partial"
          ? " Consumo parcial: faltan datos o hay mensajes en curso."
          : null}
      </p>
    </section>
  );
}

const phases = [
  { name: "Cola", detail: "Issue autorizado", short: "Cola" },
  { name: "Preparación", detail: "Base y entorno", short: "Preparación" },
  {
    name: "Implementación",
    detail: "Trabajo del agente",
    short: "Implementación",
  },
  {
    name: "Verificación",
    detail: "Evidencia independiente",
    short: "Verificación",
  },
  {
    name: "Preview y aceptación",
    detail: "Revisión humana",
    short: "Revisión",
  },
  {
    name: "Integración y cierre",
    detail: "Merge e issue cerrado",
    short: "Cierre",
  },
];

function runPhase(run: Run) {
  if (run.status === "completed" || run.publication?.mergeSha) {
    return 5;
  }
  if (run.status === "queued") {
    return 0;
  }
  if (run.phase === "preparation" || run.status === "preparing") {
    return 1;
  }
  if (run.phase === "publication") {
    return 4;
  }
  if (run.phase === "verification") {
    return 3;
  }

  return 2;
}

function PhaseNavigation({
  current,
  inspected,
  completed,
  onInspect,
}: {
  current: number;
  inspected: number;
  completed: boolean;
  onInspect: (phase: number) => void;
}) {
  return (
    <nav className="dashboard-phases" aria-label="Fases de la Ejecución">
      <ol>
        {phases.map((phase, index) => {
          const done = index < current || completed;
          const active = index === current;

          return (
            <li
              key={phase.name}
              className={`${done ? "done" : ""} ${active ? "active" : ""}`}
            >
              <button
                aria-current={active ? "step" : undefined}
                aria-pressed={inspected === index}
                title={phase.name}
                onClick={() => onInspect(index)}
              >
                <span className="dashboard-phase-number">
                  {done ? "✓" : String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <strong>{phase.short}</strong>
                </span>
                {active && !completed ? (
                  <i className="dashboard-phase-dot" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function TaskContext({
  run,
  inspected,
  current,
  onDetails,
  onVerificationDetails,
  onReturn,
}: {
  run: Run;
  inspected: number;
  current: number;
  onDetails: () => void;
  onVerificationDetails: () => void;
  onReturn: () => void;
}) {
  const report = run.verification;
  const checks = report?.checks ?? [];
  const passed = checks.filter((check) => check.status === "passed").length;
  const preview = run.publication?.preview;
  const publicationConfiguration = run.request?.configuration.publication;
  const previewMatches = Boolean(
    run.request &&
    run.publication &&
    publicationConfiguration &&
    validPreview(
      preview,
      run.publication.head,
      run.request.repository,
      publicationConfiguration.projectId,
      publicationConfiguration.previewEnvironment ?? "Preview",
    ),
  );
  const accepted =
    run.publication?.acceptance?.head === run.publication?.head &&
    Boolean(run.publication?.acceptance);
  const phase = phases[inspected];
  const pending = run.pending.length > 0 || run.status === "intervention";

  return (
    <>
      <section className="dashboard-context-section dashboard-phase-context">
        <span className="dashboard-eyebrow">
          {inspected === current ? "FASE ACTUAL" : "CONSULTANDO FASE"}
        </span>
        <h2>{phase.name}</h2>
        <p>
          {inspected === 0
            ? "La Factory espera un puesto disponible."
            : inspected === 1
              ? "Preparación del entorno y comprobación de la base."
              : inspected === 2
                ? "El agente trabaja sobre el encargo autorizado."
                : inspected === 3
                  ? "Se comprueba el Commit candidato fuera del agente."
                  : inspected === 4
                    ? "La aceptación del resultado requiere un merge humano."
                    : run.status === "completed"
                      ? "Resultado aceptado, integrado e issue cerrado."
                      : "Integración del resultado aceptado y cierre del issue."}
        </p>
        {inspected !== current ? (
          <button className="dashboard-text-button" onClick={onReturn}>
            Volver a {phases[current].short} ↗
          </button>
        ) : null}
      </section>
      {pending ? (
        <section className="dashboard-context-alert">
          <span className="dashboard-eyebrow">REQUIERE TU ATENCIÓN</span>
          <h3>
            {run.pending.length
              ? "El agente tiene una pregunta"
              : "Intervención pendiente"}
          </h3>
          <p>{run.pending[0]?.text ?? run.error}</p>
          <a href={run.request?.url} target="_blank" rel="noreferrer">
            Responder en GitHub ↗
          </a>
        </section>
      ) : null}
      {inspected === 3 && report ? (
        <section className="dashboard-context-section dashboard-check-section">
          <div className="dashboard-section-label">
            <h3>Verificación independiente</h3>
            <span>
              {passed}/{checks.length}
            </span>
          </div>
          <div className="dashboard-check-progress" aria-hidden="true">
            {checks.map((check) => (
              <i key={check.partId} className={check.status} />
            ))}
          </div>
          <ul className="dashboard-checks">
            {checks.map((check) => (
              <li key={check.partId}>
                <span className={`dashboard-check-status ${check.status}`}>
                  {check.status === "passed"
                    ? "✓"
                    : check.status === "running"
                      ? "◌"
                      : check.status === "failed"
                        ? "!"
                        : "·"}
                </span>
                <span>{check.command}</span>
                <small>
                  {check.status === "passed"
                    ? "Correcto"
                    : check.status === "running"
                      ? "En curso"
                      : check.status === "failed"
                        ? "Fallido"
                        : check.status === "uncertain"
                          ? "Incierto"
                          : "Pendiente"}
                </small>
              </li>
            ))}
          </ul>
          <button
            className="dashboard-text-button"
            onClick={onVerificationDetails}
          >
            Ver evidencia y criterios ↗
          </button>
        </section>
      ) : null}
      {inspected >= 4 && (run.publication || inspected === 4) ? (
        <section className="dashboard-context-section">
          <h3>{inspected === 5 ? "Resultado" : "Revisión del resultado"}</h3>
          <dl className="dashboard-facts">
            <Fact label="Verificación">
              {report?.status === "passed"
                ? "✓ Comprobaciones superadas"
                : "Pendiente"}
            </Fact>
            <Fact label="Preview">
              {previewMatches ? "✓ Disponible" : "Pendiente"}
            </Fact>
            <Fact label="Aceptación">
              {accepted && run.publication?.acceptance
                ? `Merge por ${run.publication.acceptance.author}`
                : "Pendiente de merge humano"}
            </Fact>
          </dl>
          {inspected === 4 ? (
            <section
              className="dashboard-review-criteria"
              aria-label="Criterios de aceptación"
            >
              <h4>Criterios de aceptación</h4>
              {report?.criteria.length ? (
                <ol>
                  {report.criteria.map((criterion, index) => (
                    <li key={index}>
                      {criterion.text.replace(/^\s*(?:[-*]\s+|\d+\.\s+)/, "")}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No hay criterios de aceptación disponibles.</p>
              )}
            </section>
          ) : null}
          {run.publication?.pull ? (
            <a
              className="dashboard-primary-link"
              href={run.publication.pull.url}
              target="_blank"
              rel="noreferrer"
            >
              Abrir PR #{run.publication.pull.number} ↗
            </a>
          ) : null}
          {preview?.url ? (
            <a
              className="dashboard-text-link"
              href={preview.url}
              target="_blank"
              rel="noreferrer"
            >
              Abrir preview ↗
            </a>
          ) : null}
        </section>
      ) : null}
      {inspected === 3 && !report ? (
        <section className="dashboard-context-section">
          <p>La verificación independiente aparecerá al comenzar esta fase.</p>
        </section>
      ) : null}
      <button className="dashboard-details-button" onClick={onDetails}>
        Configuración, procesos y evidencia <span>↗</span>
      </button>
    </>
  );
}

function DashboardDialog({
  title,
  onClose,
  children,
  initialSection,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  initialSection?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    if (initialSection) {
      const content = dialog.current?.querySelector(
        ".dashboard-dialog-content",
      );
      const section = dialog.current?.querySelector(`#${initialSection}`);
      if (content && section) {
        content.scrollTop +=
          section.getBoundingClientRect().top -
          content.getBoundingClientRect().top -
          12;
      }
    }
  }, [initialSection]);

  return (
    <dialog className="dashboard-dialog" ref={dialog} onClose={onClose}>
      <header>
        <h2>{title}</h2>
        <button onClick={onClose} aria-label="Cerrar detalle">
          ✕
        </button>
      </header>
      <div className="dashboard-dialog-content">{children}</div>
    </dialog>
  );
}

function CabinLayout({
  header,
  phases,
  timeline,
  context,
  footer,
}: LayoutProps) {
  return (
    <div className="dashboard-layout cabin-layout">
      <div className="dashboard-layout-header">{header}</div>
      <div className="dashboard-layout-phases">{phases}</div>
      <div className="dashboard-layout-stream">{timeline}</div>
      <aside className="dashboard-layout-context">{context}</aside>
      {footer}
    </div>
  );
}

interface LayoutProps {
  header: ReactNode;
  phases: ReactNode;
  timeline: ReactNode;
  context: ReactNode;
  footer: ReactNode;
}

export function Dashboard({
  view,
  onSelect,
  onDeleted,
  failing,
  lastLocal,
  now,
}: {
  view: FactoryView | null;
  onSelect: (id: string) => void;
  onDeleted: (id: string) => void;
  failing: boolean;
  lastLocal: number | null;
  now: number;
}) {
  const [inspected, setInspected] = useState<number | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const selectedRunId = view?.run?.id;
  useEffect(() => {
    if (!selectedRunId) {
      listHeading.current?.focus();
    }
  }, [selectedRunId]);
  const [dialog, setDialog] = useState<
    | "details"
    | "verification"
    | "runs"
    | "context"
    | "request"
    | "consumption"
    | "records"
    | null
  >(null);
  if (!view?.run) {
    return (
      <div className="dashboard-loading">
        <h1>App Foundry</h1>
        <h2 ref={listHeading} tabIndex={-1}>
          {view?.runs.length
            ? "Ejecuciones"
            : view
              ? "Todo empieza con una petición"
              : "Conectando con la Factory local…"}
        </h2>
        <p role="status">
          {failing
            ? "No se pudo consultar la Factory local."
            : view?.runs.length
              ? "Selecciona una ejecución para consultar su detalle."
              : "Autoriza un issue del Managed project con factory:ready."}
        </p>
        {view?.fault ? <p role="alert">{view.fault}</p> : null}
        {view?.admission.error ? (
          <p role="alert">{view.admission.error}</p>
        ) : null}
        {view?.source ? (
          <a href={view.source} target="_blank" rel="noreferrer">
            Revisar autorización en GitHub ↗
          </a>
        ) : null}
        {view?.runs.map((item) => (
          <button key={item.id} onClick={() => onSelect(item.id)}>
            {item.task}
          </button>
        ))}
      </div>
    );
  }
  const run = view.run;
  const current = runPhase(run);
  const inspectedPhase = inspected ?? current;
  const events = timelineEntries(run);
  const technicalCount = events.reduce(
    (sum, entry) =>
      sum +
      (entry.technical?.reduce(
        (count, operation) => count + operation.records.length,
        0,
      ) ?? 0),
    0,
  );
  const visible = events.filter(
    (entry) => showTechnical || entry.kind !== "technical",
  );
  const disconnected = now - (lastLocal ?? mountedAt) >= 30_000;
  const silent =
    ["running", "starting"].includes(run.status) &&
    now - (run.lastActivity ?? run.startedAt) >= 120_000;
  const opencodeDisconnected =
    run.phase !== "verification" &&
    run.phase !== "publication" &&
    !["queued", "preparing", "stopped"].includes(run.status) &&
    now - (run.lastObservation ?? run.startedAt) >= 30_000;
  const durationSeconds = Math.max(
    0,
    Math.floor(((run.endedAt ?? now) - run.startedAt) / 1000),
  );
  const duration = `${Math.floor(durationSeconds / 60)} min ${durationSeconds % 60} s`;
  const completed = run.status === "completed";
  const blocked = Boolean(
    run.error ||
    run.pending.length ||
    run.verification?.error ||
    run.verification?.effectsUncertain ||
    run.publication?.blocked ||
    run.publication?.observationError,
  );
  const connectionText = disconnected
    ? "Sin conexión · última vista conservada"
    : failing
      ? "Error al actualizar · última vista conservada"
      : "Factory conectada";
  const status = completed
    ? "Completada"
    : blocked
      ? "Requiere atención"
      : labels[run.status];

  function selectRun(id: string) {
    onSelect(id);
    setInspected(null);
    setDialog(null);
  }

  const context = (
    <TaskContext
      run={run}
      inspected={inspectedPhase}
      current={current}
      onReturn={() => setInspected(null)}
      onDetails={() => setDialog("details")}
      onVerificationDetails={() => setDialog("verification")}
    />
  );

  const header = (
    <>
      <div className="dashboard-task-heading">
        <div>
          <div className="dashboard-breadcrumb">
            <a href={run.request?.url} target="_blank" rel="noreferrer">
              {run.request
                ? `ISSUE #${run.request.number}`
                : run.id.slice(0, 8)}{" "}
              ↗
            </a>
          </div>
          <h1 title={run.request?.title ?? run.task}>
            {run.request?.title ?? run.task}
          </h1>
          <div className="dashboard-task-meta">
            <span className="dashboard-project-meta">
              {run.request?.configuration.id ?? "Ejecución manual"}
            </span>
            <i /> <span>Intento {String(run.attempt).padStart(2, "0")}</span>
            <i /> <span>{duration}</span>
            <i />{" "}
            <span>
              {run.request?.runtime.model ??
                run.runtime?.model ??
                "Modelo sin observar"}
            </span>
            <i />{" "}
            <button
              className="dashboard-header-request dashboard-tokens-meta"
              aria-haspopup="dialog"
              onClick={() => setDialog("consumption")}
            >
              {view.consumption?.usedTokens?.toLocaleString("es-ES") ??
                "Sin datos de"}{" "}
              tokens usados
            </button>
            <span className="dashboard-cost-meta">
              {view.consumption?.estimatedCost == null
                ? "Coste no disponible"
                : `Coste estimado${view.consumption.coverage === "partial" ? " (parcial)" : ""}: ${formatSummaryUsd(view.consumption.estimatedCost)}`}
            </span>
            <button
              className="dashboard-header-request"
              onClick={() => setDialog("request")}
            >
              Encargo y criterios ↗
            </button>
            {isFinished(run) ? (
              <DeleteRun key={run.id} run={run} onDeleted={onDeleted} />
            ) : null}
          </div>
        </div>
        <div className="dashboard-task-status">
          <span className={`dashboard-status ${blocked ? "attention" : ""}`}>
            <i />
            {status}
          </span>
          <small>
            {completed
              ? "Resultado integrado"
              : blocked
                ? "El puesto sigue reservado"
                : phases[current].detail}
          </small>
        </div>
      </div>
    </>
  );
  const phaseNavigation = (
    <PhaseNavigation
      current={current}
      completed={completed}
      inspected={inspectedPhase}
      onInspect={(phase) => {
        setInspected(phase);
        if (window.innerWidth < 900) {
          setDialog("context");
        }
      }}
    />
  );
  const timeline = (
    <Timeline
      key={run.id}
      runId={run.id}
      entries={visible}
      technicalCount={technicalCount}
      showTechnical={showTechnical}
      onToggleTechnical={() => setShowTechnical(!showTechnical)}
      onOriginalRecords={() => setDialog("records")}
      action={
        <button
          className="dashboard-quiet-button dashboard-mobile-context"
          onClick={() => setDialog("context")}
        >
          Contexto ↗
        </button>
      }
    />
  );
  const footer = (
    <footer className="dashboard-system-footer">
      <span className={disconnected || failing ? "dashboard-warning-text" : ""}>
        <i className={disconnected || failing ? "warning" : ""} />
        {connectionText}
      </span>
      <button onClick={() => setDialog("details")}>
        Actualizado {time(lastLocal)} ↗
      </button>
    </footer>
  );
  const layout = { header, phases: phaseNavigation, timeline, context, footer };

  return (
    <div className="factory-dashboard cabin-dashboard">
      <a className="skip-link" href="#content">
        Saltar al contenido
      </a>
      <aside
        className="dashboard-executions-sidebar"
        aria-label="Navegación de ejecuciones"
      >
        <a href="/" className="dashboard-brand">
          <span>
            F<span>·</span>
          </span>
          App Foundry
        </a>
        <div className="dashboard-executions-heading">
          <h2>
            Ejecuciones <span>{view.runs.length}</span>
          </h2>
        </div>
        <div className="dashboard-executions-scroll">
          {view.queue.length ? (
            <section>
              <h3>
                En cola <span>{view.queue.length}</span>
              </h3>
              <ul>
                {view.queue.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => selectRun(item.id)}
                      aria-current={run.id === item.id ? "true" : undefined}
                    >
                      <strong>{item.title}</strong>
                      <small>En cola</small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <h3>HISTORIAL</h3>
            <ul>
              {view.runs
                .filter((item) => item.status !== "queued")
                .map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => selectRun(item.id)}
                      aria-current={run.id === item.id ? "true" : undefined}
                    >
                      <strong>{item.task}</strong>
                      <small>
                        <i className={`dashboard-run-dot ${item.status}`} />
                        {labels[item.status]}
                      </small>
                      <time
                        className="dashboard-run-start"
                        dateTime={new Date(item.startedAt).toISOString()}
                      >
                        Inicio · {startDate(item.startedAt)}
                      </time>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        </div>
        <footer>
          <span>{run.request?.repository ?? "Ejecución manual"}</span>
        </footer>
      </aside>
      <header className="dashboard-appbar">
        <a href="/" className="dashboard-brand">
          <span>
            F<span>·</span>
          </span>
          App Foundry
        </a>
        <span className="dashboard-appbar-separator" />
        <span className="dashboard-appbar-location">
          Control de ejecuciones
        </span>
        <div className="dashboard-appbar-end">
          <span className="dashboard-local-chip">LOCAL</span>
          <button
            className="dashboard-quiet-button"
            onClick={() => setDialog("runs")}
          >
            Ejecuciones <span>{view.runs.length}</span> ⌄
          </button>
        </div>
      </header>
      <div className="dashboard-alerts">
        {view.fault ||
        view.admission.error ||
        run.error ||
        run.verification?.error ||
        run.publication?.blocked ||
        run.publication?.observationError ||
        run.verification?.effectsUncertain ||
        disconnected ||
        failing ||
        run.pending.length ? (
          <div className="dashboard-global-alert" role="status">
            <span>!</span>
            <p>
              {view.fault ??
                view.admission.error ??
                run.error ??
                run.verification?.error ??
                run.publication?.blocked ??
                run.publication?.observationError ??
                (run.verification?.effectsUncertain
                  ? "Hay procesos o efectos sin aclarar. Se requiere intervención."
                  : disconnected
                    ? "Sin respuesta local durante 30 segundos. Se conserva la última vista; los datos pueden estar desactualizados."
                    : failing
                      ? "No se pudo actualizar el estado. Se conserva la última vista."
                      : run.pending[0]?.text)}
            </p>
            {run.pending.length ? (
              <a href={run.request?.url} target="_blank" rel="noreferrer">
                Responder en GitHub ↗
              </a>
            ) : null}
          </div>
        ) : null}
        {opencodeDisconnected ? (
          <p className="dashboard-global-alert" role="status">
            Sin observación correcta de OpenCode durante 30 segundos. El enlace
            local no acredita su conexión.
          </p>
        ) : null}
        {silent ? (
          <p className="dashboard-global-alert" role="status">
            Sin actividad del agente durante 2 minutos.
          </p>
        ) : null}
      </div>
      <main id="content" tabIndex={-1} className="dashboard-main">
        <CabinLayout {...layout} />
      </main>
      {dialog ? (
        <DashboardDialog
          initialSection={
            dialog === "verification" ? "verification-title" : undefined
          }
          title={
            dialog === "records"
              ? "Registro original de la ejecución"
              : dialog === "consumption"
                ? "Tokens usados y coste estimado"
                : dialog === "request"
                  ? "Encargo y criterios"
                  : dialog === "runs"
                    ? "Ejecuciones"
                    : dialog === "context"
                      ? "Contexto de la ejecución"
                      : "Evidencia y detalles de la ejecución"
          }
          onClose={() => setDialog(null)}
        >
          {dialog === "consumption" ? (
            view.consumption ? (
              <ConsumptionDetails consumption={view.consumption} />
            ) : null
          ) : dialog === "request" ? (
            <section className="dashboard-request-detail">
              <h3>{run.request?.title ?? "Encargo de la Ejecución"}</h3>
              <pre tabIndex={0}>{run.request?.body ?? run.task}</pre>
              {run.request ? (
                <a href={run.request.url} target="_blank" rel="noreferrer">
                  Abrir issue #{run.request.number} en GitHub ↗
                </a>
              ) : null}
            </section>
          ) : dialog === "records" ? (
            <section className="dashboard-original-records">
              <p>
                {run.history.length} registros de historial y {run.parts.length}{" "}
                salidas disponibles en la API local.
              </p>
              <p>
                El historial se muestra aquí sin agrupar. Las notificaciones de
                salida se corresponden con los mensajes, las herramientas y las
                evidencias de la cronología.
              </p>
              <details className="dashboard-record-coverage">
                <summary>Alcance de la observación</summary>
                <p>
                  Se muestran los datos retenidos por la Factory. La observación
                  de OpenCode conserva campos seleccionados; no acredita una
                  captura completa del proveedor.
                </p>
                <ul>
                  {run.gaps.map((gap, index) => (
                    <li key={index}>{gap}</li>
                  ))}
                </ul>
              </details>
              <ol className="dashboard-original-history">
                {run.history.map((record, index) => (
                  <li key={index}>
                    <header>
                      <time>{time(record.at)}</time>
                      <code>{record.kind}</code>
                      <span>#{index + 1}</span>
                    </header>
                    <pre tabIndex={0}>{record.text}</pre>
                  </li>
                ))}
              </ol>
              <details>
                <summary>Salidas completas · {run.parts.length}</summary>
                <ul className="outputs">
                  {run.parts.map((part) => (
                    <Output key={part.id} runId={run.id} part={part} />
                  ))}
                </ul>
              </details>
            </section>
          ) : dialog === "runs" ? (
            <div className="dashboard-run-picker">
              <h3>Historial</h3>
              {view.runs.map((item) => (
                <button
                  key={item.id}
                  aria-current={item.id === run.id ? "true" : undefined}
                  onClick={() => {
                    onSelect(item.id);
                    setInspected(null);
                    setDialog(null);
                  }}
                >
                  <strong>{item.task}</strong>
                  <span>
                    {labels[item.status]} · Inicio {startDate(item.startedAt)}
                  </span>
                </button>
              ))}
              <h3>En cola · {view.queue.length}</h3>
              {view.queue.length ? (
                view.queue.map((item) => (
                  <button key={item.id} onClick={() => selectRun(item.id)}>
                    {item.title}
                  </button>
                ))
              ) : (
                <p>No hay ejecuciones en cola.</p>
              )}
            </div>
          ) : dialog === "context" ? (
            context
          ) : (
            <>
              <RunDetails run={run} />
              <VerificationDetails run={run} />
              <PublicationDetails run={run} />
              <IntegrationDetails run={run} />
              {run.pending.length ? (
                <section className="card" aria-labelledby="pending-title">
                  <h2 id="pending-title">Solicitudes pendientes</h2>
                  <ul>
                    {run.pending.map((pending) => (
                      <li key={pending.id}>
                        <strong>
                          {pending.kind === "permission"
                            ? "Permiso"
                            : "Pregunta"}
                        </strong>
                        <pre>{pending.text}</pre>
                        <small>ID: {pending.id}</small>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <section className="card">
                <h2>Salidas completas</h2>
                <ul className="outputs">
                  {run.parts.map((part) => (
                    <Output key={part.id} runId={run.id} part={part} />
                  ))}
                </ul>
              </section>
              <section className="card">
                <h2>Observación y consumo</h2>
                <p>Última respuesta local: {age(lastLocal, now)}</p>
                <p>
                  Última observación del agente: {age(run.lastObservation, now)}
                </p>
                <p>Última actividad: {age(run.lastActivity, now)}</p>
                <pre>
                  {JSON.stringify(
                    {
                      consumption: view.consumption,
                      admission: view.admission,
                      process: run.process,
                      sessionId: run.sessionId,
                      gaps: run.gaps,
                    },
                    null,
                    2,
                  )}
                </pre>
              </section>
            </>
          )}
        </DashboardDialog>
      ) : null}
    </div>
  );
}

const mountedAt = Date.now();
