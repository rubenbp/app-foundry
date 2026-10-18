import type { Factory } from "./factory.ts";
import type { Observation } from "./runRepository.ts";
import { queuedRuns } from "../domain/queue.ts";
import { consumption, type Run } from "../domain/run.ts";

/** Proyección de solo lectura compartida por el adaptador HTTP local y el Dashboard. */
export interface FactoryView {
  serverNow: number;
  admission: Observation;
  source: string | null;
  queue: { id: string; title: string }[];
  fault: string | null;
  runs: Pick<Run, "id" | "task" | "status" | "startedAt">[];
  run: Run | null;
  consumption: ReturnType<typeof consumption> | null;
}

export function factoryView(
  factory: Factory,
  selection: string | null,
  serverNow: number,
): FactoryView {
  const runs = factory.list();
  const queue = queuedRuns(runs);
  const selected = selection ?? factory.active ?? queue[0]?.id ?? runs[0]?.id;
  const run = runs.find((r) => r.id === selected) ?? null;

  return {
    serverNow,
    fault: factory.fault,
    admission: factory.store.observation(),
    source: factory.config.managedProject
      ? `https://github.com/${factory.config.managedProject.repository}/issues`
      : null,
    queue: queue.map((r) => ({
      id: r.id,
      title: r.request?.title ?? r.task,
    })),
    runs: runs.map((r) => ({
      id: r.id,
      task: r.request?.title ?? r.task,
      status: r.status,
      startedAt: r.startedAt,
    })),
    run,
    consumption: run ? consumption(run.usage) : null,
  };
}
