// Throwaway projection. Preserve every source record while reducing repetition.
import type { History, Run } from "../../src/domain/run.ts";
import type { TimelineEntry } from "./timeline.tsx";

export interface TechnicalOperation {
  id: string;
  at: number;
  endedAt: number | null;
  label: string;
  state: "started" | "confirmed" | "observed";
  records: History[];
  references: { label: string; value: string }[];
  note?: string;
  category?: "signals" | "comments";
}

export const technicalKinds = new Set([
  "opencode-status",
  "intent",
  "confirmed",
  "process-started",
  "comment-consumed",
  "agent-stop",
]);

const operationNames: Record<string, string> = {
  "Prepare owned clone and verify base":
    "Preparar el entorno y comprobar la base",
  "Create owned clone and branch": "Crear el clon y la rama de la Ejecución",
  "Capture base identity and complete instructions":
    "Capturar la base y las instrucciones",
  "Start owned OpenCode server": "Iniciar el servidor de OpenCode",
  "Create OpenCode session": "Crear la sesión de OpenCode",
  "Send task once; no automatic retry": "Entregar el encargo a OpenCode",
  "Stop agent editing before fixing candidate head":
    "Detener la edición antes de fijar el Commit candidato",
};
const confirmationKeys: Record<string, string> = {
  "Owned OpenCode server started": "Start owned OpenCode server",
  "OpenCode session created": "Create OpenCode session",
  "Task delivered to OpenCode": "Send task once; no automatic retry",
  "Base checks passed; owned workspace prepared":
    "Prepare owned clone and verify base",
};
const issueLabelNames: Record<string, string> = {
  "factory:queued": "en cola",
  "factory:in-progress": "en curso",
  "factory:pending-review": "pendiente de revisión",
  "factory:completed": "completado",
};
const mergeStatusNames: Record<string, string> = {
  pending: "pendiente",
  success: "correcto",
  failure: "fallido",
  error: "error",
};

function describeOperation(entry: History, run: Run) {
  const key = confirmationKeys[entry.text] ?? entry.text;
  const [action, ...values] = key.split(":");
  const references: TechnicalOperation["references"] = [];
  let label = operationNames[key];
  let note: string | undefined;
  let category: TechnicalOperation["category"];
  if (action === "push") {
    label = "Publicar el Commit candidato en GitHub";
    references.push({ label: "Commit candidato", value: values[0] });
  } else if (action === "pull") {
    label = "Preparar la PR del Commit candidato";
  } else if (action === "status") {
    label = `Actualizar el check de merge a «${mergeStatusNames[values[1]] ?? values[1]}»`;
    references.push(
      { label: "Commit candidato", value: values[0] },
      { label: "Estado del check en GitHub", value: values[1] },
    );
    note =
      "Es el check «Factory / ready-to-merge» de GitHub. Su estado no equivale a la aceptación humana del resultado.";
  } else if (action === "review-ready") {
    label = "Avisar de que el resultado está listo para revisión";
    const value = values[0];
    references.push({
      label:
        run.publication?.preview?.id === value
          ? "ID de la preview"
          : run.publication?.report?.id === value
            ? "ID del informe publicado"
            : "Referencia de la notificación",
      value,
    });
    note =
      "La referencia identifica el informe o la preview asociados a la notificación; no es un número de issue.";
  } else if (action === "report") {
    label = "Publicar el informe de revisión";
    references.push(
      { label: "Commit candidato", value: values[0] },
      { label: "ID de la preview", value: values[1] },
    );
    if (values[2]) {
      references.push({ label: "Hash del informe", value: values[2] });
    }
  } else if (action === "description") {
    label = "Actualizar la descripción de la PR";
    references.push({ label: "Commit candidato", value: values[0] });
  } else if (action === "integration-report" || action === "close-issue") {
    label =
      action === "integration-report"
        ? "Publicar el resumen de integración"
        : "Cerrar el issue tras la integración";
    references.push({ label: "Commit integrado", value: values[0] });
  } else if (key.startsWith("Issue label: ")) {
    const value = key.slice("Issue label: ".length);
    label = `Etiquetar el issue: ${issueLabelNames[value] ?? value}`;
    references.push({ label: "Etiqueta de GitHub", value });
  } else if (key.startsWith("Prepare base: ")) {
    label = `Preparar la base · ${key.slice("Prepare base: ".length)}`;
  } else if (key.startsWith("Check pre-existing base: ")) {
    label = `Comprobar la base · ${key.slice("Check pre-existing base: ".length)}`;
  } else if (entry.kind === "opencode-status") {
    label = "Señales internas de OpenCode";
    category = "signals";
  } else if (entry.kind === "comment-consumed") {
    label = "Comentarios procesados por la Factory";
    category = "comments";
  } else if (entry.kind === "process-started") {
    label = "Proceso de OpenCode iniciado";
  } else if (entry.kind === "agent-stop") {
    label = "Detención del agente observada";
  }

  return {
    key,
    label: label ?? "Operación interna de la Factory",
    references,
    note,
    category,
  };
}

export function technicalOperations(run: Run): TechnicalOperation[] {
  const operations: TechnicalOperation[] = [];
  const started = new Map<string, TechnicalOperation[]>();
  run.history.forEach((entry, index) => {
    if (!technicalKinds.has(entry.kind)) {
      return;
    }
    const description = describeOperation(entry, run);
    if (entry.kind === "agent-stop") {
      const pending = started
        .get("Stop agent editing before fixing candidate head")
        ?.shift();
      if (pending) {
        pending.records.push(entry);
        pending.endedAt = entry.at;
        pending.state = "observed";
        pending.note =
          "Se observó la respuesta a la detención. El registro de origen conserva qué procesos se comprobaron y los límites sobre efectos del proveedor.";
        return;
      }
    }
    if (entry.kind === "confirmed") {
      const pending = started.get(description.key)?.shift();
      if (pending) {
        pending.records.push(entry);
        pending.endedAt = entry.at;
        pending.state = "confirmed";
        return;
      }
    }
    const operation: TechnicalOperation = {
      id: `technical-${index}`,
      at: entry.at,
      endedAt: entry.kind === "confirmed" ? entry.at : null,
      label: description.label,
      state:
        entry.kind === "intent"
          ? "started"
          : entry.kind === "confirmed"
            ? "confirmed"
            : "observed",
      records: [entry],
      references: description.references,
      note: description.note,
      category: description.category,
    };
    operations.push(operation);
    if (entry.kind === "intent") {
      const queue = started.get(description.key) ?? [];
      queue.push(operation);
      started.set(description.key, queue);
    }
  });

  return operations;
}

export function groupTechnicalEntries(
  entries: TimelineEntry[],
): TimelineEntry[] {
  const result: TimelineEntry[] = [];
  for (const entry of entries) {
    const last = result.at(-1);
    if (entry.kind === "technical" && last?.kind === "technical") {
      last.technical!.push(...entry.technical!);
      continue;
    }
    result.push(
      entry.kind === "technical"
        ? { ...entry, technical: [...entry.technical!] }
        : entry,
    );
  }
  for (const entry of result) {
    if (!entry.technical) {
      continue;
    }
    const compact: TechnicalOperation[] = [];
    for (const operation of entry.technical) {
      const previous = operation.category
        ? compact.find((item) => item.category === operation.category)
        : undefined;
      if (previous) {
        previous.records.push(...operation.records);
        previous.endedAt = operation.at;
      } else {
        compact.push({ ...operation, records: [...operation.records] });
      }
    }
    for (const operation of compact) {
      if (operation.category === "signals") {
        const failures = operation.records.filter(
          (record) => record.text === "tool.failed",
        ).length;
        operation.label = `OpenCode · ${operation.records.length} señales internas${failures ? ` · ${failures} fallo observado` : ""}`;
      } else if (operation.category === "comments") {
        operation.label = `${operation.records.length} comentarios procesados por la Factory`;
      }
    }
    entry.technical = compact;
  }

  return result;
}
