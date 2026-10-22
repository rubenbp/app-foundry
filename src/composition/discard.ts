import type { FactoryConfig } from "../application/configuration.ts";
import { discardRun } from "../domain/run.ts";
import { acquireWorkflowOwnership } from "../infrastructure/ownership.ts";
import { Store } from "../infrastructure/persistence/store.ts";
import { assertRunProcessesStopped } from "../infrastructure/runProcesses.ts";

/** Offline maintenance: no Factory recovery, agents, GitHub or Vercel clients. */
export function discardExecution(config: FactoryConfig, id: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new Error(
      "Indica --id con el ID completo de la Ejecución del Dashboard.",
    );
  }
  if (!config.managedProject) {
    throw new Error(
      "El descarte requiere la configuración del Managed project.",
    );
  }
  const ownership = acquireWorkflowOwnership(config);
  try {
    const store = new Store(config.dataDir);
    try {
      const run = store.list().find((run) => run.id === id);
      if (!run) {
        throw new Error(
          `No se encontró la Ejecución ${id} en esta carpeta de datos.`,
        );
      }
      if (
        run.request &&
        run.request.repository.toLowerCase() !==
          config.managedProject.repository.toLowerCase()
      ) {
        throw new Error("La Ejecución pertenece a otro Managed project.");
      }
      const reserved = ownership.reservation();
      if (reserved && reserved !== id) {
        throw new Error(`Otra Ejecución conserva el puesto: ${reserved}.`);
      }
      assertRunProcessesStopped(config.dataDir, run);
      const discarded = discardRun(run, Date.now());
      if (discarded !== run) {
        store.save(discarded);
      }
      // Persist first: a failed release can be retried without losing the reserved run.
      ownership.releaseRun(id);
      return discarded;
    } finally {
      store.close();
    }
  } finally {
    ownership.close();
  }
}
