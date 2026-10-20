import {
  technicalHistory,
  technicalKinds,
  type TechnicalOperation,
} from "./technical.ts";
import type { History, PartView, Run } from "../src/domain/run.ts";

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
  operation?: TechnicalOperation;
}

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
  publication?: Run["publication"];
}): TimelineEntry[] {
  const technical = technicalHistory(run.history, run.publication);
  const history: TimelineEntry[] = run.history.flatMap((entry, index) =>
    entry.kind === "part" || technical.consumed.has(index)
      ? []
      : [
          {
            id: `history-${index}`,
            at: entry.at,
            kind:
              /error|gap|intervention|recovery/.test(entry.kind) ||
              entry.kind === "process-exit" ||
              technical.operations
                .get(index)
                ?.operation.records.some(
                  ({ record }) =>
                    record.kind === "confirmed" &&
                    /^status:[a-f\d]{40}:(failure|error)$/.test(record.text),
                ) ||
              (entry.kind === "opencode-status" &&
                /error|failed/.test(entry.text))
                ? "error"
                : technicalKinds.has(entry.kind)
                  ? "technical"
                  : "event",
            label:
              technical.operations.get(index)?.label ??
              (Object.hasOwn(historyLabels, entry.kind)
                ? historyLabels[entry.kind]!
                : entry.kind),
            operation: technical.operations.get(index)?.operation,
            text: entry.text,
            history: entry,
            result:
              entry.kind === "result" ? (run.result ?? undefined) : undefined,
            version: JSON.stringify([
              entry,
              technical.operations.get(index)?.operation,
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

  const ordered = [...history, ...parts].sort(
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
  const compact: TimelineEntry[] = [];
  const segment = new Map<string, TimelineEntry>();
  for (const entry of ordered) {
    if (entry.kind !== "technical") {
      segment.clear();
    }
    const category =
      entry.kind === "technical" ? entry.operation?.category : undefined;
    const previous = category ? segment.get(category) : undefined;
    if (previous?.operation && entry.operation) {
      previous.operation.records.push(...entry.operation.records);
      previous.version = JSON.stringify(previous.operation);
    } else {
      compact.push(entry);
      if (category) {
        segment.set(category, entry);
      }
    }
  }
  return compact;
}
