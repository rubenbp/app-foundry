import type { Run } from "../types.ts";

export function queuedRuns(runs: Run[]) {
  return runs
    .filter((run) => run.status === "queued")
    .sort(
      (a, b) =>
        (a.request?.capturedAt ?? a.startedAt) -
          (b.request?.capturedAt ?? b.startedAt) ||
        (a.request?.authorization.at ?? "").localeCompare(
          b.request?.authorization.at ?? "",
        ) ||
        (a.request?.number ?? 0) - (b.request?.number ?? 0) ||
        a.id.localeCompare(b.id),
    );
}
