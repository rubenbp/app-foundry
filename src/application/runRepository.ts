import type { Run } from "../domain/run.ts";

export interface Observation {
  at: number;
  error: string | null;
  lastSuccess: number | null;
}

/**
 * Registros duraderos de Ejecuciones y evidencias.
 * Si falla una escritura, se bloquean los efectos posteriores.
 */
export interface RunRepository {
  readonly failed: boolean;
  observation(value?: { at: number; error: string | null }): Observation;
  save(run: Run): void;
  deleteRun(id: string): void;
  list(): Run[];
  write(runId: string, partId: string, text: string): void;
  output(runId: string, partId: string): string | null;
  close(): void;
}
