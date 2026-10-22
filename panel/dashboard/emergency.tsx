import { useState } from "react";
import type { FactoryView } from "../../src/application/factoryView.ts";

function EmergencyCommand({
  title,
  action,
  command,
  description,
  example,
}: {
  title: string;
  action: string;
  command: string;
  description: string;
  example: string;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <article className="dashboard-emergency-action">
      <h3>{title}</h3>
      <p>{description}</p>
      <p>
        <strong>Ejemplo:</strong> {example}
      </p>
      <div className="dashboard-emergency-command">
        <pre tabIndex={0}>
          <code>{command}</code>
        </pre>
        <button
          type="button"
          className="dashboard-emergency-copy"
          aria-label={`Copiar comando para ${action}`}
          title={copyStatus === "copied" ? "Copiado" : "Copiar comando"}
          onClick={copyCommand}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            {copyStatus === "copied" ? (
              <path d="m5 12 4 4L19 6" />
            ) : (
              <>
                <rect x="8" y="8" width="12" height="13" rx="2" />
                <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
              </>
            )}
          </svg>
        </button>
      </div>
      <p className="dashboard-emergency-feedback" role="status">
        {copyStatus === "copied"
          ? `Comando para ${action} copiado.`
          : copyStatus === "failed"
            ? "No se pudo copiar. Selecciona el comando y cópialo manualmente."
            : ""}
      </p>
    </article>
  );
}

export function EmergencyDetails({
  commands,
}: {
  commands: NonNullable<FactoryView["emergencyCommands"]>;
}) {
  return (
    <section
      className="card dashboard-emergency"
      aria-labelledby="dashboard-emergency-title"
    >
      <h2 id="dashboard-emergency-title">Para emergencias</h2>
      <p>
        Ejecuta estos comandos desde la carpeta que contiene{" "}
        <code>factory.local.json</code>, donde el wizard creó{" "}
        <code>start-factory.sh</code>. Incluyen el ID de esta ejecución.
      </p>
      <EmergencyCommand
        title="Parar la ejecución"
        action="parar"
        command={commands.stop}
        description="Con la Factory funcionando, intenta detener el trabajo y liberar el puesto de forma controlada. Puede necesitar acceso a GitHub."
        example="El agente está trabajando y quieres interrumpir la prueba."
      />
      {commands.discard ? (
        <EmergencyCommand
          title="Descartar la ejecución"
          action="descartar"
          command={commands.discard}
          description="Cierra primero la Factory con Ctrl-C. Libera el puesto si no hay procesos registrados activos y conserva el historial y los recursos remotos."
          example="La parada falla al contactar con GitHub o la ejecución está atascada cerrando el issue tras el merge."
        />
      ) : null}
      <p>Estos comandos conservan los datos locales y no revierten un merge.</p>
    </section>
  );
}
