import { useEffect, useState } from "react";
import type { PartView } from "../../src/domain/run.ts";
import { Button } from "./button.tsx";
import { dateTime } from "../format.ts";

type Observation = { text: string; at: number };
type OutputState = {
  status: "idle" | "loading" | "available" | "missing" | "error";
  observation: Observation | null;
};

/** Reads only when inspected and retains the last successful observation on failure. */
export function Output({ runId, part }: { runId: string; part: PartView }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<OutputState>({
    status: "idle",
    observation: null,
  });
  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    void Promise.resolve().then(async () => {
      if (!active) {
        return;
      }
      setState((previous) => ({ ...previous, status: "loading" }));
      try {
        const response = await fetch(
          `/api/runs/${encodeURIComponent(runId)}/outputs/${encodeURIComponent(part.id)}`,
          { signal: controller.signal },
        );
        if (!active) {
          return;
        }
        if (response.status === 404) {
          setState((previous) => ({ ...previous, status: "missing" }));
          return;
        }
        if (!response.ok) {
          throw new Error("Output read failed");
        }
        const text = await response.text();
        if (active) {
          setState({
            status: "available",
            observation: { text, at: part.updatedAt },
          });
        }
      } catch {
        if (active) {
          setState((previous) => ({ ...previous, status: "error" }));
        }
      } finally {
        clearTimeout(timeout);
      }
    });
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [open, runId, part.id, part.updatedAt]);
  return (
    <div className="output" id={`part-${part.id}`}>
      <Button
        id={`output-toggle-${part.id}`}
        variant="ghost"
        aria-expanded={open}
        aria-controls={`output-detail-${part.id}`}
        onClick={() => {
          if (!open) {
            document.dispatchEvent(new CustomEvent("cabina:inspect"));
          }
          setOpen((value) => !value);
        }}
      >
        <span>
          {open ? "−" : "+"} {part.label}
        </span>
        {part.truncated ? <span>Truncada</span> : null}
      </Button>
      {open ? (
        <div id={`output-detail-${part.id}`}>
          {state.status === "loading" || state.status === "idle" ? (
            <p role="status">Cargando salida…</p>
          ) : null}
          {state.status === "missing" ? (
            <p className="notice warning" role="status">
              Artefacto ausente; hay una laguna de observación.
            </p>
          ) : null}
          {state.status === "error" ? (
            <p className="notice danger" role="alert">
              Error al leer la salida. No se dispone de una observación
              actualizada.
            </p>
          ) : null}
          {part.truncated ? (
            <p className="notice warning">
              Salida truncada. Solo se conserva el fragmento disponible.
            </p>
          ) : null}
          {state.observation ? (
            <>
              <p className="small muted">
                {state.status === "available"
                  ? "Observación disponible"
                  : "Última observación disponible · Sin actualizar"}
                : {dateTime(state.observation.at)}
              </p>
              <pre id={`output-${part.id}`} tabIndex={0}>
                {state.observation.text}
              </pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
