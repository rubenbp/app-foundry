import { useEffect, useState } from "react";
import type { PartView } from "../../src/domain/run.ts";
import { Button } from "./button.tsx";
import { time } from "../format.ts";

export function Output({ runId, part }: { runId: string; part: PartView }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    void fetch(
      `/api/runs/${encodeURIComponent(runId)}/outputs/${encodeURIComponent(part.id)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value = await response.text();
        if (!controller.signal.aborted) setText(value);
      })
      .catch(() => setError(true))
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [open, runId, part.id, part.updatedAt]);
  return (
    <li className="output" id={`part-${part.id}`}>
      <Button
        variant="ghost"
        aria-expanded={open}
        aria-controls={`output-${part.id}`}
        onClick={() => {
          if (!open) setError(false);
          setOpen((value) => !value);
        }}
      >
        <span>
          {open ? "−" : "+"} {part.label}
        </span>
        <span className="muted">
          {time(part.updatedAt)}
          {part.truncated ? " · Truncada" : ""}
        </span>
      </Button>
      {open ? (
        <pre id={`output-${part.id}`} tabIndex={0}>
          {error
            ? "Salida no disponible. Puede existir una laguna de observación."
            : (text ?? "Cargando salida…")}
        </pre>
      ) : null}
    </li>
  );
}
