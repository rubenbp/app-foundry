import type { Run } from "./run.ts";

export type RecoveryCommand =
  | { kind: "retry" }
  | { kind: "correct"; instructions: string }
  | { kind: "cancel" };

// Solo las órdenes completas del contrato activan operaciones. El resto sigue siendo conversación.
export function recoveryCommand(body: string): RecoveryCommand | null {
  const text = body.trim();
  if (/^Reintentar$/i.test(text)) {
    return { kind: "retry" };
  }
  if (/^Cancelar$/i.test(text)) {
    return { kind: "cancel" };
  }
  const correction = /^Corregir:\s*([\s\S]+)$/i.exec(text);

  return correction?.[1].trim()
    ? { kind: "correct", instructions: correction[1].trim() }
    : null;
}

export function recoveryActions(run: Run): RecoveryCommand["kind"][] {
  if (run.publication?.mergeSha || run.publication?.pull?.merged) {
    return run.status === "intervention" ? ["retry"] : [];
  }
  const actions: RecoveryCommand["kind"][] = ["cancel"];
  if (run.status === "intervention") {
    actions.unshift("retry");
  }
  if (
    run.sessionId &&
    run.workspace &&
    (run.status === "intervention" ||
      run.status === "awaiting_review" ||
      run.status === "awaiting_merge")
  ) {
    actions.push("correct");
  }
  return actions;
}

export function recoveryNotice(run: Run) {
  const actions = recoveryActions(run);

  return [
    "## La Factory necesita intervención",
    `Ejecución: ${run.id}. Fase: ${run.phase ?? "preparation"}.`,
    run.error ?? "El recorrido requiere una decisión humana.",
    "Se conservan la conversación, el trabajo y las evidencias disponibles. El puesto sigue reservado.",
    "Responde en este issue con una de las siguientes órdenes:",
    ...(actions.includes("retry")
      ? [
          "- `Reintentar`: vuelve a ejecutar la fase fallida después de corregir la causa.",
        ]
      : []),
    ...(actions.includes("correct")
      ? [
          "- `Corregir: instrucciones`: pide otro Intento al agente, en la misma conversación y rama. Se verificarán de nuevo los cambios y se pedirá otra aceptación.",
        ]
      : []),
    ...(actions.includes("cancel")
      ? [
          "- `Cancelar`: detiene la Ejecución y cierra el issue como no implementado cuando se confirma la parada.",
        ]
      : []),
    "Si la causa requiere credenciales o una actuación local, el operador debe corregirla antes de reintentar.",
    `<!-- app-foundry:recovery:${run.id}:${run.history.length} -->`,
  ].join("\n\n");
}
