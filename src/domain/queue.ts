import type { Run } from "./run.ts";

export function queuedRuns(runs: Run[]) {
  return runs
    .filter((run) => run.status === "queued")
    .sort(
      (a, b) =>
        (a.request?.capturedAt ?? a.startedAt) -
          (b.request?.capturedAt ?? b.startedAt) ||
        (a.request?.number ?? 0) - (b.request?.number ?? 0) ||
        a.id.localeCompare(b.id),
    );
}
