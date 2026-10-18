import type { RunStatus } from "../src/domain/run.ts";

export const labels: Record<RunStatus, string> = {
  queued: "En cola",
  preparing: "Preparando base",
  starting: "Preparando",
  running: "En curso",
  waiting: "Espera humana",
  awaiting_verification: "Resultado sin verificar",
  verifying: "Verificando Commit candidato",
  awaiting_preview: "Verificado · Preview pendiente",
  awaiting_review: "Esperando revisión humana",
  awaiting_merge: "Esperando merge humano",
  closing_issue: "Cerrando issue",
  completed: "Completada",
  intervention: "Requiere intervención",
  stopped: "Detenida",
};
export const time = (value: number | null) =>
  value === null
    ? "No disponible"
    : new Date(value).toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
export const age = (value: number | null, now: number) =>
  value === null
    ? "Sin observación"
    : `Hace ${Math.max(0, Math.floor((now - value) / 1000))} s`;
