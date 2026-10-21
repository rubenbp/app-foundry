import { useId, useRef, useState } from "react";
import type { Run } from "../../src/domain/run.ts";

export function DeleteRun({
  run,
  onDeleted,
}: {
  run: Run;
  onDeleted: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(15_000),
      });
      // A lost success response or deletion in another tab is also reconciled.
      if (response.status !== 204 && response.status !== 404) {
        const body: unknown = await response.json();
        throw new Error(
          body &&
            typeof body === "object" &&
            "error" in body &&
            typeof body.error === "string"
            ? body.error
            : "No se pudo completar el borrado. Puedes reintentar.",
        );
      }
      dialog.current?.close();
      onDeleted(run.id);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === "Error"
          ? cause.message
          : "No se pudo confirmar el borrado. Comprueba la conexión y vuelve a intentarlo.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <button
        className="dashboard-delete-trigger"
        aria-haspopup="dialog"
        onClick={() => {
          setError(null);
          dialog.current?.showModal();
          cancel.current?.focus();
        }}
      >
        Eliminar ejecución
      </button>
      <dialog
        ref={dialog}
        className="dashboard-dialog dashboard-delete-dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={(event) => {
          if (inFlight.current) {
            event.preventDefault();
          }
        }}
      >
        <header>
          <h2 id={titleId}>Eliminar ejecución</h2>
        </header>
        <div className="dashboard-dialog-content">
          <p>
            <strong>{run.request?.title ?? run.task}</strong>
          </p>
          <p id={descriptionId}>
            Se eliminarán el registro, el clon completo con sus cambios locales,
            la conversación y las evidencias de esta ejecución. Esta acción no
            se puede deshacer.
          </p>
          <p>
            El issue, el código integrado y los recursos remotos se conservan.
          </p>
          {error ? <p role="alert">{error}</p> : null}
          <div className="dashboard-delete-actions" aria-busy={pending}>
            <button
              ref={cancel}
              disabled={pending}
              onClick={() => dialog.current?.close()}
            >
              Cancelar
            </button>
            <button
              className="dashboard-delete-confirm"
              disabled={pending}
              onClick={() => void remove()}
            >
              {pending ? "Eliminando…" : "Eliminar"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
