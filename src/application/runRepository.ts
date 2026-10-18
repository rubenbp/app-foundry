import type { Run } from "../domain/run.ts";

export interface Observation {
  at: number;
  error: string | null;
  lastSuccess: number | null;
}

/** Durable execution records and evidence. A failed write blocks further effects. */
export interface RunRepository {
  readonly failed: boolean;
  observation(value?: { at: number; error: string | null }): Observation;
  save(run: Run): void;
  list(): Run[];
  write(runId: string, partId: string, text: string): void;
  output(runId: string, partId: string): string | null;
  close(): void;
}
