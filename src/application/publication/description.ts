import type { Run } from "../../domain/run.ts";

// El agente escribe la descripción; la Factory solo separa el título del Markdown.
// No se evalúa ni se bloquea la entrega por su contenido editorial.
export function pullDescription(run: Run) {
  const [title, ...body] = (run.result ?? "").trim().split(/\r?\n/);

  return {
    title: title || run.request!.title,
    body: `${body.join("\n").trim() || run.request!.body}\n\nIssue: ${run.request!.url}`,
  };
}
