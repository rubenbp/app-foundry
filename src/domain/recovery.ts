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
      run.status === "awaiting_preview")
  ) {
    actions.push("correct");
  }
  return actions;
}

export function recoveryNotice(run: Run) {
  const actions = recoveryActions(run);
  const verification =
    run.phase === "verification" ? run.verification : undefined;
  const failedCheck = verification?.checks.find(
    (check) => check.status === "failed" || check.status === "uncertain",
  );

  return [
    "## La Factory necesita intervención",
    `Ejecución: ${run.id}. Fase: ${run.phase ?? "preparation"}.`,
    run.error ?? "El recorrido requiere una decisión humana.",
    ...(verification?.headSha
      ? [`Commit candidato: ${verification.headSha}.`]
      : []),
    ...(failedCheck
      ? [
          `Comando afectado: \`${failedCheck.command}\`.`,
          failedCheck.code === null
            ? "Código de salida sin confirmar."
            : `Código de salida: ${failedCheck.code}.`,
          `Abre el Dashboard, selecciona esta Ejecución y despliega la salida de «${failedCheck.command}» para ver el error completo.`,
          ...(verification?.checks.some((check) => check.status === "not_run")
            ? ["Los comandos posteriores no se han ejecutado."]
            : []),
        ]
      : []),
    ...(verification?.effectsUncertain
      ? [
          "Confirma primero la parada y limpieza de los procesos indicados. Hasta aclararlos, el puesto sigue reservado.",
        ]
      : []),
    "Se conservan la conversación, el trabajo y las evidencias disponibles. El puesto sigue reservado.",
    "Responde en este issue con una de las siguientes órdenes:",
    ...(actions.includes("retry")
      ? [
          verification
            ? "- `Reintentar`: repite la verificación del mismo código después de resolver la causa. Para encargar cambios al agente, usa `Corregir: instrucciones`."
            : "- `Reintentar`: vuelve a ejecutar la fase fallida después de corregir la causa.",
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
    ...(failedCheck &&
    !verification?.effectsUncertain &&
    actions.includes("correct")
      ? [
          "Si el agente debe corregir el código, publica: `Corregir: Corrige el fallo de verificación indicado y deja el candidato listo para verificar.`",
        ]
      : []),
    "Si la causa requiere credenciales o una actuación local, el operador debe corregirla antes de reintentar.",
    `<!-- app-foundry:recovery:${run.id}:${run.history.length} -->`,
  ].join("\n\n");
}
