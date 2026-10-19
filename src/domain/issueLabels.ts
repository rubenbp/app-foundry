import type { RunStatus } from "./run.ts";

export const issueLabels = {
  "factory:ready": {
    color: "0e8a16",
    description: "Issue autorizado para la Factory, pendiente de admisión",
  },
  "factory:queued": {
    color: "c5def5",
    description: "Admitido y esperando turno",
  },
  "factory:in-progress": {
    color: "1d76db",
    description: "Trabajo automático de la Factory en curso",
  },
  "factory:needs-human": {
    color: "d93f0b",
    description: "Pregunta del agente o incidencia que requiere intervención",
  },
  "factory:pending-review": {
    color: "fbca04",
    description: "Preview lista: revisar y hacer merge de la PR para aceptar",
  },
  "factory:completed": {
    color: "0e8a16",
    description: "Integración, resumen y cierre confirmados",
  },
  "factory:stopped": {
    color: "b60205",
    description: "Trabajo detenido",
  },
} as const;

export type IssueLabel = keyof typeof issueLabels;

const runLabels: Record<RunStatus, IssueLabel> = {
  queued: "factory:queued",
  preparing: "factory:in-progress",
  starting: "factory:in-progress",
  running: "factory:in-progress",
  waiting: "factory:needs-human",
  awaiting_verification: "factory:in-progress",
  verifying: "factory:in-progress",
  awaiting_preview: "factory:in-progress",
  awaiting_review: "factory:pending-review",
  closing_issue: "factory:in-progress",
  completed: "factory:completed",
  intervention: "factory:needs-human",
  stopped: "factory:stopped",
};

export function issueLabel(status: RunStatus): IssueLabel {
  return runLabels[status];
}
