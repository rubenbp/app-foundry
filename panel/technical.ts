import type { History, Run } from "../src/domain/run.ts";

export interface TechnicalOperation {
  state: "started" | "confirmed" | "observed";
  records: { index: number; record: History }[];
  references: { label: string; value: string }[];
  note?: string;
  category?: "signals" | "comments" | "states";
}

export const technicalKinds = new Set([
  "intent",
  "confirmed",
  "state",
  "opencode-status",
  "process-started",
  "process-exit",
  "comment-consumed",
  "agent-stop",
  "stop",
]);
const fallbackLabel = "Operación interna de la Factory";
const operationNames: Record<string, string> = {
  "Prepare owned clone and verify base":
    "Preparar el entorno y comprobar la base",
  "Create owned clone and branch": "Crear el clon y la rama de la Ejecución",
  "Capture base identity and complete instructions":
    "Capturar la base y las instrucciones",
  "Start owned OpenCode server": "Iniciar el servidor de OpenCode",
  "Send task once; no automatic retry": "Entregar el encargo a OpenCode",
  "Create OpenCode session": "Crear la sesión de OpenCode",
  "Stop agent editing before fixing candidate head":
    "Detener la edición antes de fijar el Commit candidato",
  "Abort session and stop owned process group":
    "Detener la sesión y el grupo de procesos de la Factory",
};
const confirmationKeys: Record<string, string> = {
  "Base checks passed; owned workspace prepared":
    "Prepare owned clone and verify base",
  "Owned OpenCode server started": "Start owned OpenCode server",
  "Task delivered to OpenCode": "Send task once; no automatic retry",
  "OpenCode session created": "Create OpenCode session",
};
const mergeStates: Record<string, string> = {
  pending: "pendiente",
  success: "correcto",
  failure: "fallido",
  error: "error",
};
const observationLimit =
  "Respuesta a la detención observada; no acredita todos los efectos del proveedor. Consulte los límites del registro original.";

type Description = {
  key: string;
  label: string;
  known: boolean;
  references: TechnicalOperation["references"];
  category?: TechnicalOperation["category"];
  note?: string;
};

function describe(
  record: History,
  publication?: Run["publication"],
): Description {
  if (!["intent", "confirmed", "agent-stop", "stop"].includes(record.kind)) {
    const labels: Record<string, string> = {
      "opencode-status": "Señales internas de OpenCode",
      state: "Estados internos de la Factory",
      "comment-consumed": "Comentarios procesados por la Factory",
      "process-started": "Inicio de proceso observado",
      "process-exit": "Salida de proceso observada",
    };
    const categories: Record<string, TechnicalOperation["category"]> = {
      "opencode-status": "signals",
      state: "states",
      "comment-consumed": "comments",
    };

    return {
      key: record.text,
      label: Object.hasOwn(labels, record.kind)
        ? labels[record.kind]!
        : "Observación técnica",
      known: false,
      references: [],
      category: categories[record.kind],
    };
  }
  const key =
    record.kind === "agent-stop"
      ? "Stop agent editing before fixing candidate head"
      : record.kind === "stop"
        ? "Abort session and stop owned process group"
        : record.kind === "confirmed"
          ? Object.hasOwn(confirmationKeys, record.text)
            ? confirmationKeys[record.text]!
            : record.text
          : record.text;
  const known = Object.hasOwn(operationNames, key);
  const description: Description = {
    key,
    label: known ? operationNames[key]! : fallbackLabel,
    known,
    references: [],
  };
  const publicationAction =
    /^(prepare|push|description|integration-report|close-issue):([a-f\d]{40})$/;
  const match = publicationAction.exec(key);
  const status = /^status:([a-f\d]{40}):(pending|success|failure|error)$/.exec(
    key,
  );
  const report = /^report:([a-f\d]{40}):([^:]+)(?::(.+))?$/.exec(key);
  if (match) {
    const labels: Record<string, string> = {
      prepare: "Preparar la publicación del Commit candidato",
      push: "Publicar el Commit candidato en GitHub",
      description: "Actualizar la descripción de la PR",
      "integration-report": "Publicar el resumen de integración",
      "close-issue": "Cerrar el issue tras la integración",
    };
    description.label = labels[match[1]!]!;
    description.references.push({
      label: ["integration-report", "close-issue"].includes(match[1]!)
        ? "Commit integrado"
        : "Commit candidato",
      value: match[2]!,
    });
    description.known = true;
  } else if (key === "pull") {
    description.label = "Preparar la PR del Commit candidato";
    description.known = true;
  } else if (status) {
    description.label = `Actualizar el check de merge a «${mergeStates[status[2]!]!}»`;
    description.references.push(
      { label: "Commit candidato", value: status[1]! },
      { label: "Estado del check en GitHub", value: status[2]! },
    );
    description.note =
      "Check Factory / ready-to-merge; su estado no equivale a la aceptación humana del resultado.";
    description.known = true;
  } else if (report) {
    description.label = "Publicar el informe de revisión";
    description.references.push(
      { label: "Commit candidato", value: report[1]! },
      { label: "ID de la preview", value: report[2]! },
    );
    if (report[3]) {
      description.references.push({
        label: "Hash del informe",
        value: report[3],
      });
    }
    description.known = true;
  } else if (key.startsWith("review-ready:") && key.length > 13) {
    const value = key.slice(13);
    description.label = "Avisar de que el resultado está listo para revisión";
    const previews = [
      publication?.preview,
      ...(publication?.deployments.map(({ preview }) => preview) ?? []),
    ];
    const reports = [publication?.report, ...(publication?.reports ?? [])];
    description.references.push({
      label: previews.some((preview) => preview?.id === value)
        ? "ID de la preview"
        : reports.some((report) => report?.id === value)
          ? "ID del informe publicado"
          : "Referencia de la notificación",
      value,
    });
    description.known = true;
  } else if (key.startsWith("Issue label: ")) {
    description.label = `Etiquetar el issue: ${key.slice(13)}`;
    description.references.push({
      label: "Etiqueta de GitHub",
      value: key.slice(13),
    });
    description.known = true;
  } else if (
    key.startsWith("Prepare base: ") ||
    key.startsWith("Check pre-existing base: ")
  ) {
    const prepare = key.startsWith("Prepare base: ");
    description.label = `${prepare ? "Preparar" : "Comprobar"} la base · ${key.slice(prepare ? 14 : 25)}`;
    description.known = true;
  }
  return description;
}

/** Only producer-defined correspondences can associate retained observations. */
export function technicalHistory(
  history: History[],
  publication?: Run["publication"],
) {
  const operations = new Map<
    number,
    { label: string; operation: TechnicalOperation }
  >();
  const pending = new Map<string, number[]>();
  const consumed = new Set<number>();
  history.forEach((record, index) => {
    if (!technicalKinds.has(record.kind)) {
      return;
    }
    const description = describe(record, publication);
    const observation = record.kind === "agent-stop" || record.kind === "stop";
    const confirmationMatches =
      Object.hasOwn(confirmationKeys, record.text) ||
      !Object.hasOwn(operationNames, record.text) ||
      [
        "Create owned clone and branch",
        "Capture base identity and complete instructions",
      ].includes(record.text);
    const previous =
      ((record.kind === "confirmed" && confirmationMatches) || observation) &&
      description.known
        ? pending.get(description.key)?.shift()
        : undefined;
    if (previous !== undefined) {
      const operation = operations.get(previous)!.operation;
      operation.records.push({ index, record });
      operation.state = observation ? "observed" : "confirmed";
      operation.note = observation ? observationLimit : description.note;
      consumed.add(index);
      return;
    }
    const limit =
      record.kind === "intent"
        ? "Intención observada sin confirmación."
        : record.kind === "confirmed"
          ? "Confirmación sin inicio observado."
          : observation
            ? `Detención sin inicio observado. ${observationLimit}`
            : undefined;
    operations.set(index, {
      label: description.label,
      operation: {
        state:
          record.kind === "intent"
            ? "started"
            : record.kind === "confirmed"
              ? "confirmed"
              : "observed",
        records: [{ index, record }],
        references: description.references,
        category: description.category,
        note:
          [
            limit,
            description.note,
            !description.known && ["intent", "confirmed"].includes(record.kind)
              ? "Clave sin correspondencia conocida; el registro conserva lo observado sin atribuir un efecto."
              : undefined,
          ]
            .filter(Boolean)
            .join(" ") || undefined,
      },
    });
    if (record.kind === "intent" && description.known) {
      const queue = pending.get(description.key) ?? [];
      queue.push(index);
      pending.set(description.key, queue);
    }
  });
  return { operations, consumed };
}
