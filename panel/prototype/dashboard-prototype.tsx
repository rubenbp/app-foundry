// THROWAWAY: three structurally different Dashboard layouts on /?variant=A|B|C.
// Question: can an operator follow a Run without page scrolling or losing history?
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { FactoryView } from "../../src/application/factoryView.ts";
import type { Run } from "../../src/domain/run.ts";
import {
  PrototypeSwitcher,
  type PrototypeVariant,
} from "../components/prototype-switcher.tsx";
import { IssueDetails } from "../issue.tsx";
import { VerificationDetails } from "../verification.tsx";
import { PublicationDetails } from "../publication.tsx";
import { IntegrationDetails } from "../integration.tsx";
import { Output } from "../components/output.tsx";
import { labels, time, age } from "../format.ts";
import {
  TimelinePrototype,
  timelineEntries,
  type TimelineEntry,
} from "./timeline-prototype.tsx";
import "./dashboard-prototype.css";

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
const scenarios = [
  { value: "preparation", label: "Preparación", phase: 1 },
  { value: "implementation", label: "Implementación", phase: 2 },
  { value: "verification", label: "Verificación", phase: 3 },
  { value: "review", label: "Revisión humana", phase: 4 },
  { value: "completed", label: "Completada", phase: 5 },
  { value: "intervention", label: "Intervención", phase: 2 },
  { value: "disconnected", label: "Sin conexión", phase: 3 },
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

function replayRun(source: Run, scenario: string): Run {
  const run = structuredClone(source);
  const phase = scenarios.find((item) => item.value === scenario)?.phase ?? 3;
  const verificationStart =
    run.verification?.checks[0]?.startedAt ??
    run.parts.find((part) => part.messageId === "verification")?.updatedAt;
  const implementationStart =
    run.parts.find((part) => part.kind === "tool")?.updatedAt ?? run.startedAt;
  const cutoff =
    phase === 1
      ? implementationStart - 1
      : phase === 2
        ? (verificationStart ?? Infinity) - 1
        : phase === 3
          ? (run.parts.find(
              (part) => part.id === run.verification?.checks[1]?.partId,
            )?.updatedAt ?? Infinity)
          : phase === 4
            ? (run.publication?.acceptance?.at ?? Infinity) - 1
            : Infinity;
  run.history = run.history.filter((entry) => entry.at <= cutoff);
  run.parts = run.parts.filter((part) => part.updatedAt <= cutoff);
  run.endedAt = phase === 5 ? source.endedAt : null;
  run.phase =
    phase === 1
      ? "preparation"
      : phase === 2
        ? "implementation"
        : phase === 3
          ? "verification"
          : "publication";
  run.status =
    phase === 1
      ? "preparing"
      : phase === 2
        ? "running"
        : phase === 3
          ? "verifying"
          : phase === 4
            ? "awaiting_review"
            : "completed";
  run.error = null;
  run.pending = [];
  if (phase < 3) {
    delete run.verification;
    run.result = null;
  } else if (phase === 3 && run.verification) {
    run.verification.status = "running";
    run.verification.checks = run.verification.checks.map((check, index) => ({
      ...check,
      status: index < 2 ? "passed" : index === 2 ? "running" : "not_run",
      code: index < 2 ? 0 : null,
      endedAt: index < 2 ? check.endedAt : null,
    }));
  }
  if (phase < 4) {
    delete run.publication;
  } else if (phase === 4 && run.publication) {
    delete run.publication.acceptance;
    delete run.publication.mergeSha;
    delete run.publication.closedAt;
    delete run.publication.integrationReport;
    if (run.publication.pull) {
      run.publication.pull.merged = false;
      run.publication.pull.open = true;
      delete run.publication.pull.mergeSha;
      delete run.publication.pull.mergedBy;
      delete run.publication.pull.mergedAt;
    }
  }
  if (scenario === "intervention") {
    run.status = "waiting";
    run.pending = [
      {
        id: "prototype-question",
        kind: "question",
        text: "¿El nuevo mensaje debe aparecer también en las páginas del catálogo?",
      },
    ];
  }

  return run;
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
    <nav className="proto-phases" aria-label="Fases de la Ejecución">
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
                onClick={() => onInspect(index)}
              >
                <span className="proto-phase-number">
                  {done ? "✓" : String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <strong>{phase.name}</strong>
                  <small>{phase.detail}</small>
                </span>
                {active && !completed ? (
                  <i className="proto-phase-dot" />
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
  view,
  inspected,
  current,
  onDetails,
  onReturn,
}: {
  run: Run;
  view: FactoryView;
  inspected: number;
  current: number;
  onDetails: () => void;
  onReturn: () => void;
}) {
  const report = run.verification;
  const checks = report?.checks ?? [];
  const passed = checks.filter((check) => check.status === "passed").length;
  const preview = run.publication?.preview;
  const phase = phases[inspected];
  const pending = run.pending.length > 0 || run.status === "intervention";

  return (
    <>
      <div className="proto-context-title">
        <span className="proto-eyebrow">CONTEXTO DE LA EJECUCIÓN</span>
        <span className="proto-context-pin" title="Siempre visible">
          ⌖
        </span>
      </div>
      <section className="proto-context-section proto-phase-context">
        <span className="proto-eyebrow">
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
          <button className="proto-text-button" onClick={onReturn}>
            Volver a {phases[current].short} ↗
          </button>
        ) : null}
      </section>
      {pending ? (
        <section className="proto-context-alert">
          <span className="proto-eyebrow">REQUIERE TU ATENCIÓN</span>
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
        <section className="proto-context-section proto-check-section">
          <div className="proto-section-label">
            <h3>Verificación independiente</h3>
            <span>
              {passed}/{checks.length}
            </span>
          </div>
          <div className="proto-check-progress" aria-hidden="true">
            {checks.map((check) => (
              <i key={check.partId} className={check.status} />
            ))}
          </div>
          <ul className="proto-checks">
            {checks.map((check) => (
              <li key={check.partId}>
                <span className={`proto-check-status ${check.status}`}>
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
          <button className="proto-text-button" onClick={onDetails}>
            Ver evidencia y criterios ↗
          </button>
          <p className="proto-fine-print">
            Los checks no acreditan la aceptación del resultado.
          </p>
        </section>
      ) : null}
      {inspected >= 4 && run.publication ? (
        <section className="proto-context-section">
          <h3>{inspected === 5 ? "Resultado" : "Revisión del resultado"}</h3>
          <dl className="proto-facts">
            <Fact label="Verificación">
              {report?.status === "passed"
                ? "✓ Comprobaciones superadas"
                : "Pendiente"}
            </Fact>
            <Fact label="Preview">
              {preview?.state === "success" ? "✓ Disponible" : "Pendiente"}
            </Fact>
            <Fact label="Aceptación">
              {run.publication.acceptance
                ? `Merge por ${run.publication.acceptance.author}`
                : "Pendiente de merge humano"}
            </Fact>
          </dl>
          {run.publication.pull ? (
            <a
              className="proto-primary-link"
              href={run.publication.pull.url}
              target="_blank"
              rel="noreferrer"
            >
              Abrir PR #{run.publication.pull.number} ↗
            </a>
          ) : null}
          {preview?.url ? (
            <a
              className="proto-text-link"
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
        <section className="proto-context-section">
          <p>La verificación independiente aparecerá al comenzar esta fase.</p>
        </section>
      ) : null}
      <section className="proto-context-section">
        <h3>Encargo</h3>
        <dl className="proto-facts">
          <Fact label="Proyecto">
            {run.request?.configuration.id ?? "Ejecución manual"}
          </Fact>
          <Fact label="Issue">
            {run.request ? (
              <a href={run.request.url} target="_blank" rel="noreferrer">
                #{run.request.number} ↗
              </a>
            ) : (
              "Sin issue"
            )}
          </Fact>
          <Fact label="Intento">{String(run.attempt).padStart(2, "0")}</Fact>
          <Fact label="Modelo">
            {run.request?.runtime.model ?? run.runtime?.model ?? "Sin observar"}
          </Fact>
        </dl>
        <details className="proto-inline-details">
          <summary>Ver encargo y criterios</summary>
          <pre>{run.request?.body ?? run.task}</pre>
        </details>
      </section>
      <section className="proto-context-section proto-resource-context">
        <h3>Recursos</h3>
        <dl className="proto-facts">
          <Fact label="Tokens observados">
            {view.consumption?.observedTokens?.toLocaleString("es-ES") ??
              "No disponible"}
          </Fact>
          <Fact label="Estimación SDK">
            {view.consumption?.estimatedCost != null
              ? `$${view.consumption.estimatedCost.toFixed(4)}`
              : "No disponible"}
          </Fact>
        </dl>
        <p className="proto-fine-print">
          Consumo observado de la ejecución. No equivale a gasto facturado.
        </p>
      </section>
      <button className="proto-details-button" onClick={onDetails}>
        Configuración, procesos y evidencia <span>↗</span>
      </button>
    </>
  );
}

function PrototypeDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog className="proto-dialog" ref={dialog} onClose={onClose}>
      <header>
        <h2>{title}</h2>
        <button onClick={onClose} aria-label="Cerrar detalle">
          ✕
        </button>
      </header>
      <div className="proto-dialog-content">{children}</div>
    </dialog>
  );
}

function VariantA({ header, phases, timeline, context, footer }: LayoutProps) {
  return (
    <div className="proto-layout variant-a">
      <div className="proto-layout-header">{header}</div>
      <div className="proto-layout-phases">{phases}</div>
      <div className="proto-layout-stream">{timeline}</div>
      <aside className="proto-layout-context">{context}</aside>
      {footer}
    </div>
  );
}

function VariantB({ header, phases, timeline, context, footer }: LayoutProps) {
  return (
    <div className="proto-layout variant-b">
      <div className="proto-layout-header">{header}</div>
      <aside className="proto-layout-phases">{phases}</aside>
      <div className="proto-layout-stream">{timeline}</div>
      <aside className="proto-layout-context">{context}</aside>
      {footer}
    </div>
  );
}

function VariantC({
  header,
  phases,
  timeline,
  footer,
  dock,
}: LayoutProps & { dock: ReactNode }) {
  return (
    <div className="proto-layout variant-c">
      <div className="proto-layout-header">{header}</div>
      <div className="proto-layout-phases">{phases}</div>
      <div className="proto-layout-stream">{timeline}</div>
      <aside className="proto-layout-dock">{dock}</aside>
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

const simulationMessages = [
  "Comprobando el mensaje del pie en la página de inicio y en Sobre.",
  "Revisando que el enlace de marca conserva la navegación al inicio.",
  "Nueva evidencia de ejecución disponible para consultar.",
  "El agente continúa con el siguiente criterio del encargo.",
];

export default function DashboardPrototype({
  view,
  onSelect,
  failing,
  lastLocal,
  now,
}: {
  view: FactoryView | null;
  onSelect: (id: string) => void;
  failing: boolean;
  lastLocal: number | null;
  now: number;
}) {
  const [variant, setVariant] = useState<PrototypeVariant>(() => {
    const key = new URLSearchParams(location.search).get("variant");

    return key === "B" || key === "C" ? key : "A";
  });
  const [replay, setReplay] = useState(
    () => new URLSearchParams(location.search).get("replay") === "1",
  );
  const [scenario, setScenario] = useState("verification");
  const [playing, setPlaying] = useState(false);
  const [extra, setExtra] = useState<TimelineEntry[]>([]);
  const [inspected, setInspected] = useState<number | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const [following, setFollowing] = useState(true);
  const [dialog, setDialog] = useState<"details" | "runs" | "context" | null>(
    null,
  );
  const changeVariant = useCallback((key: PrototypeVariant) => {
    const url = new URL(location.href);
    url.searchParams.set("variant", key);
    history.replaceState(null, "", url);
    setVariant(key);
  }, []);
  useEffect(() => {
    const pop = () => {
      const key = new URLSearchParams(location.search).get("variant");
      setVariant(key === "B" || key === "C" ? key : "A");
    };
    window.addEventListener("popstate", pop);

    return () => window.removeEventListener("popstate", pop);
  }, []);

  const addEvent = useCallback(() => {
    setExtra((previous) => {
      const count = previous.length;

      return [
        ...previous,
        {
          id: `simulation-${count}`,
          at: Date.now(),
          kind: count % 3 === 1 ? "tool" : "message",
          label: count % 3 === 1 ? "shell · comprobación simulada" : "Agente",
          text: simulationMessages[count % simulationMessages.length],
          simulated: true,
        },
      ];
    });
  }, []);
  useEffect(() => {
    if (
      !playing ||
      !replay ||
      scenario === "completed" ||
      scenario === "intervention" ||
      scenario === "disconnected"
    ) {
      return;
    }
    const timer = setInterval(addEvent, 3500);

    return () => clearInterval(timer);
  }, [playing, replay, scenario, addEvent]);

  if (!view?.run) {
    return (
      <div className="proto-loading">
        <h1>App Foundry</h1>
        <p>
          {failing
            ? "No se pudo consultar la Factory en el puerto 4310."
            : "Cargando ejecución desde la Factory local…"}
        </p>
        <a href="http://127.0.0.1:4310/">Abrir Dashboard actual ↗</a>
      </div>
    );
  }
  const source = view.run;
  const run = replay ? replayRun(source, scenario) : source;
  const current = runPhase(run);
  const inspectedPhase = inspected ?? current;
  const events = [...timelineEntries(run), ...(replay ? extra : [])];
  const technicalCount = events.filter(
    (entry) => entry.kind === "technical",
  ).length;
  const visible = events.filter(
    (entry) => showTechnical || entry.kind !== "technical",
  );
  const disconnected =
    (replay && scenario === "disconnected") ||
    (lastLocal !== null && now - lastLocal > 30_000);
  const durationSeconds = Math.floor(
    ((run.endedAt ??
      (replay ? (run.history.at(-1)?.at ?? run.startedAt) : now)) -
      run.startedAt) /
      1000,
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
  const context = (
    <TaskContext
      run={run}
      view={view}
      inspected={inspectedPhase}
      current={current}
      onReturn={() => setInspected(null)}
      onDetails={() => setDialog("details")}
    />
  );

  const header = (
    <>
      <div className="proto-task-heading">
        <div>
          <div className="proto-breadcrumb">
            <span>EJECUCIONES</span>
            <span>/</span>
            <a href={run.request?.url} target="_blank" rel="noreferrer">
              {run.request
                ? `ISSUE #${run.request.number}`
                : run.id.slice(0, 8)}{" "}
              ↗
            </a>
            {replay ? (
              <span className="proto-replay-tag">SIMULACIÓN</span>
            ) : null}
          </div>
          <h1>{run.request?.title ?? run.task}</h1>
          <div className="proto-task-meta">
            <span>{run.request?.repository ?? "Ejecución manual"}</span>
            <i /> <span>Intento {String(run.attempt).padStart(2, "0")}</span>
            <i /> <span>{duration}</span>
          </div>
        </div>
        <div className="proto-task-status">
          <span className={`proto-status ${blocked ? "attention" : ""}`}>
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
        if (variant === "C" || window.innerWidth < 900) {
          setDialog("context");
        }
      }}
    />
  );
  const timeline = (
    <TimelinePrototype
      key={`${run.id}:${replay}:${scenario}`}
      runId={run.id}
      entries={visible}
      technicalCount={technicalCount}
      showTechnical={showTechnical}
      onToggleTechnical={() => setShowTechnical(!showTechnical)}
      onFollowChange={setFollowing}
      action={
        <button
          className={`proto-quiet-button ${variant === "A" ? "proto-mobile-context" : ""}`}
          onClick={() => setDialog("context")}
        >
          Contexto ↗
        </button>
      }
    />
  );
  const footer = (
    <footer className="proto-system-footer">
      <span className={disconnected || failing ? "proto-warning-text" : ""}>
        <i className={disconnected || failing ? "warning" : ""} />
        {connectionText}
      </span>
      <span>Solo consulta · decisiones en GitHub</span>
      <button onClick={() => setDialog("details")}>
        {replay
          ? "Datos de una ejecución real"
          : `Actualizado ${time(lastLocal)}`}{" "}
        ↗
      </button>
    </footer>
  );
  const dock = (
    <>
      <button
        onClick={() => {
          setInspected(null);
          setDialog("context");
        }}
      >
        <small>AHORA · FASE {current + 1} / 6</small>
        <strong>
          {phases[current].name}
          <span>↗</span>
        </strong>
      </button>
      <button onClick={() => setDialog("details")}>
        <small>EVIDENCIA TÉCNICA</small>
        <strong>
          {run.verification
            ? `${
                run.verification.checks.filter(
                  (check) => check.status === "passed",
                ).length
              } / ${run.verification.checks.length} checks correctos`
            : "Disponible en verificación"}
          <span>↗</span>
        </strong>
      </button>
      <button onClick={() => setDialog("context")}>
        <small>{blocked ? "REQUIERE ATENCIÓN" : "SIGUIENTE PASO"}</small>
        <strong>
          {completed
            ? "Issue cerrado"
            : blocked
              ? "Responder en GitHub"
              : current < 4
                ? "Revisión humana"
                : "Merge humano"}
          <span>↗</span>
        </strong>
      </button>
    </>
  );
  const layout = { header, phases: phaseNavigation, timeline, context, footer };

  return (
    <div className={`dashboard-prototype prototype-${variant.toLowerCase()}`}>
      <header className="proto-appbar">
        <a href="/?variant=A" className="proto-brand">
          <span>
            F<span>·</span>
          </span>
          App Foundry
        </a>
        <span className="proto-appbar-separator" />
        <span className="proto-appbar-location">Control de ejecuciones</span>
        <div className="proto-appbar-end">
          <span className="proto-local-chip">LOCAL</span>
          <button
            className="proto-quiet-button"
            onClick={() => setDialog("runs")}
          >
            Ejecuciones <span>{view.runs.length}</span> ⌄
          </button>
          <a
            href="http://127.0.0.1:4310/"
            target="_blank"
            rel="noreferrer"
            className="proto-original-link"
          >
            Dashboard actual ↗
          </a>
        </div>
      </header>
      <div className="proto-lab-toolbar" aria-label="Controles del prototipo">
        <span className="proto-lab-label">LAB</span>
        <div className="proto-source-toggle">
          <button
            aria-pressed={!replay}
            onClick={() => {
              setReplay(false);
              setPlaying(false);
              setInspected(null);
              const url = new URL(location.href);
              url.searchParams.delete("replay");
              history.replaceState(null, "", url);
            }}
          >
            Datos en vivo
          </button>
          <button
            aria-pressed={replay}
            onClick={() => {
              setReplay(true);
              setInspected(null);
              const url = new URL(location.href);
              url.searchParams.set("replay", "1");
              history.replaceState(null, "", url);
            }}
          >
            Simular actividad
          </button>
        </div>
        {replay ? (
          <>
            <label className="proto-scenario-label">
              Escenario
              <select
                value={scenario}
                onChange={(event) => {
                  setScenario(event.target.value);
                  setExtra([]);
                  setInspected(null);
                  setPlaying(false);
                }}
              >
                {scenarios.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="proto-quiet-button"
              onClick={() => setPlaying(!playing)}
              disabled={["completed", "intervention", "disconnected"].includes(
                scenario,
              )}
            >
              {playing ? "Ⅱ Pausar" : "▷ Reproducir"}
            </button>
            <button className="proto-quiet-button" onClick={addEvent}>
              + Añadir evento
            </button>
            <span className="proto-lab-hint">
              Simulación en memoria · sin cambios en la Factory
            </span>
          </>
        ) : (
          <span className="proto-lab-hint">
            Estado real · consulta cada 2 s
          </span>
        )}
      </div>
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
        <div className="proto-global-alert" role="status">
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
                  ? "La conexión se ha perdido. Se conserva la última vista; los datos pueden estar desactualizados."
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
      <main className="proto-main">
        {variant === "A" ? (
          <VariantA {...layout} />
        ) : variant === "B" ? (
          <VariantB {...layout} />
        ) : (
          <VariantC {...layout} dock={dock} />
        )}
      </main>
      <PrototypeSwitcher
        variant={variant}
        onChange={changeVariant}
        state={
          <pre>
            {JSON.stringify(
              {
                question:
                  "Seguir la ejecución y consultar el pasado sin scroll de página",
                variant,
                mode: replay
                  ? "simulación en memoria"
                  : "API local de solo lectura",
                scenario: replay ? scenario : null,
                run: run.id,
                status: run.status,
                currentPhase: phases[current].name,
                inspectedPhase: phases[inspectedPhase].name,
                followingEnd: following,
                entries: visible.length,
                hiddenTechnicalEntries: showTechnical ? 0 : technicalCount,
                simulatedEntries: replay ? extra.length : 0,
                disconnected,
                lastLocalResponse: time(lastLocal),
              },
              null,
              2,
            )}
          </pre>
        }
      />
      {dialog ? (
        <PrototypeDialog
          title={
            dialog === "runs"
              ? "Ejecuciones"
              : dialog === "context"
                ? "Contexto de la ejecución"
                : "Evidencia y detalles de la ejecución"
          }
          onClose={() => setDialog(null)}
        >
          {dialog === "runs" ? (
            <div className="proto-run-picker">
              <h3>Historial</h3>
              {view.runs.map((item) => (
                <button
                  key={item.id}
                  aria-current={item.id === run.id ? "true" : undefined}
                  onClick={() => {
                    onSelect(item.id);
                    setExtra([]);
                    setInspected(null);
                    setPlaying(false);
                    setDialog(null);
                  }}
                >
                  <strong>{item.task}</strong>
                  <span>
                    {labels[item.status]} · {time(item.startedAt)}
                  </span>
                </button>
              ))}
              <h3>En cola · {view.queue.length}</h3>
              {view.queue.length ? (
                view.queue.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelect(item.id);
                      setDialog(null);
                    }}
                  >
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
              <IssueDetails run={run} />
              <VerificationDetails run={run} />
              <PublicationDetails run={run} />
              <IntegrationDetails run={run} />
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
        </PrototypeDialog>
      ) : null}
    </div>
  );
}
