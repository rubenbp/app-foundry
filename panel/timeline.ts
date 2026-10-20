import type { History, PartView } from "../src/domain/run.ts";

export interface TimelineEntry {
  id: string;
  at: number;
  kind: "event" | "message" | "tool" | "evidence" | "error" | "technical";
  label: string;
  version: string;
  text?: string;
  part?: PartView;
  history?: History;
  result?: string;
}

export const technicalKinds = new Set([
  "intent",
  "confirmed",
  "state",
  "opencode-status",
  "process-started",
  "process-exit",
  "comment-consumed",
]);
const historyLabels: Record<string, string> = {
  admitted: "Issue autorizado · En cola",
  result: "Resultado del agente · Sin verificar",
  verification: "Verificación independiente",
  "agent-stop": "Detención de la edición observada",
  "merge-observed": "Merge humano observado",
  completed: "Ejecución completada",
  "agent-intervention": "El agente necesita una respuesta",
};

/** Projection of retained observations. Output times are updates, never call starts. */
export function timelineEntries(run: {
  history: History[];
  parts: PartView[];
  result?: string | null;
}): TimelineEntry[] {
  const history: TimelineEntry[] = run.history.flatMap((entry, index) =>
    entry.kind === "part"
      ? []
      : [
          {
            id: `history-${index}`,
            at: entry.at,
            kind:
              /error|gap|intervention|recovery/.test(entry.kind) ||
              (entry.kind === "opencode-status" &&
                /error|failed/.test(entry.text))
                ? "error"
                : technicalKinds.has(entry.kind)
                  ? "technical"
                  : "event",
            label: historyLabels[entry.kind] ?? entry.kind,
            text: entry.text,
            history: entry,
            result:
              entry.kind === "result" ? (run.result ?? undefined) : undefined,
            version: JSON.stringify([
              entry,
              entry.kind === "result" ? run.result : null,
            ]),
          },
        ],
  );
  const parts: TimelineEntry[] = run.parts.map((part) => ({
    id: `part-${part.id}`,
    at: part.updatedAt,
    kind: /(?: · (?:error|failed)| · exit [1-9])/.test(part.label)
      ? "error"
      : part.kind === "text"
        ? "message"
        : part.kind === "tool"
          ? "tool"
          : "evidence",
    label: part.label,
    part,
    version: JSON.stringify(part),
  }));

  return [...history, ...parts].sort(
    (left, right) =>
      left.at - right.at ||
      Number(Boolean(left.part)) - Number(Boolean(right.part)) ||
      (left.history && right.history
        ? Number(left.id.slice(8)) - Number(right.id.slice(8))
        : left.id < right.id
          ? -1
          : left.id > right.id
            ? 1
            : 0),
  );
}
